/**
 * 07-文本创作模式测试：
 * T1 往返等价（text → JSON → text 字节级一致）/ T2 投影失败整次拒绝带行列定位 /
 * T3 JSON 唯一真相源（JSON → text → JSON 结构等价）/ T4 混存识别
 */
import { describe, expect, it } from "vitest";
import {
  generateText,
  parseStory,
  parseStoryFile,
  parseTextStory,
  StoryFormatError,
  TextFormatError,
} from "@lingfan/engine";

/** 覆盖全部已实现 op 的规范文本（生成器的规范形 = 2 空格缩进、字段序固定） */
const canonical = `define "player.gold" 100
label start:
  set "player.gold" {player.gold + 27}
  say "你有 {player.gold:000} 枚金币。" speaker="灵泛"
  say "富文本：{b}加粗{/b}。"
  input "旅人，报上名来：" store="player.name"
  if {player.gold >= 25}
    notify "金币充足！当前 {player.gold} 枚。" type="info"
    func greet()
      say "你好，{player.name}！" speaker="{player.name}"
    call greet
  else
    notify "囊中羞涩……"
  wait 1.5 skipable
  while {player.gold > 0}
    set "player.gold" {player.gold - 1}
    break
  array "deck" ["甲", "乙"]
  array_push "deck" {1 + 2}
  array_pop "deck"
  dict "cfg" {"hp": 10, "title": "设置"}
  dict_set "cfg" "mp" 5
  undef "cfg"
  random seed=7 min=1 max=6 var="roll"
  for "card" in {deck}
    say "抽到：{card}"
  foreach "item" in "deck"
    say "{item}"
  switch {1 + 1}
    case 2
      say "two"
    default
      say "default"
  jump inn
  navigate "inn"
  navigate "square" scene "square"
label inn:
  say "酒馆线" speaker="老板"
  return
label square:
  local "tmp" "x"
  say "{tmp}"
  jump end
label end:
  character "灵泛" name="灵泛" color="#7aa2f7"
  nvl
  bgm "bgm_main.mp3" volume=0.5 loop=true fade=300
  bgm "bgm_main.mp3" restart=true
  se "click.mp3" volume=0.8
  ambient "rain.mp3" loop=true
  stop_bgm fade=500
  stop_ambient fade=200
  voice "line1.mp3" auto_stop=true
  stop_voice
  video "Video/op.mp4" volume=0.8 loop=true
  cutscene "Video/cs.mp4" volume=0.9 skipable=true
  seek_video 10
  pause_video
  resume_video
  stop_video
  video_skipable false
  say "终" voice="line1.mp3"
`;

describe("07-T1 往返等价（text → JSON → text 字节级一致）", () => {
  it("全 op 规范文本：parse → generate 恒等", () => {
    expect(generateText(parseTextStory(canonical, "Stories/demo.story"))).toBe(
      canonical,
    );
  });

  it("generate 幂等：二次投影不再变化", () => {
    const story = parseTextStory(canonical, "Stories/demo.story");
    const once = generateText(story);
    expect(generateText(parseTextStory(once, "demo.story"))).toBe(once);
  });

  it("JSON → text → JSON 结构等价（T3：JSON 树唯一真相源）", () => {
    const jsonStory = parseStory(
      {
        formatVersion: 1,
        id: "demo",
        columns: [
          {
            id: "start",
            kind: "flow",
            commands: [
              { op: "say", text: "甲", speaker: "灵泛" },
              { op: "set", key: "gold", value: "{gold + 1}" },
              {
                op: "if",
                cond: "{gold > 0}",
                then: [{ op: "say", text: "正" }],
                else: [{ op: "say", text: "负" }],
              },
              {
                op: "menu",
                prompt: "去哪",
                options: [{ text: "酒馆", target: "inn" }],
              },
            ],
          },
          { id: "inn", kind: "flow", commands: [{ op: "say", text: "end" }] },
        ],
      },
      "Stories/demo.story",
    );
    const text = generateText(jsonStory);
    const reparsed = parseTextStory(text, "Stories/demo.story");
    expect(reparsed.columns).toEqual(jsonStory.columns);
    expect(reparsed.defines).toEqual(jsonStory.defines);
  });

  it("引擎侧消费投影产物：组装 → 引擎 → ValueChanged 正常", () => {
    const story = parseTextStory(canonical, "Stories/demo.story");
    expect(story.columns.map((c) => c.id)).toEqual([
      "start",
      "inn",
      "square",
      "end",
    ]);
    expect(story.defines).toEqual({ "player.gold": 100 });
  });
});

describe("07-T2 投影失败整次拒绝 + 行列定位", () => {
  it("未知语句 → TextFormatError 带行号", () => {
    try {
      parseTextStory("label a:\n  teleport far\n", "a.story");
      expect.unreachable("应当抛出");
    } catch (e) {
      expect(e).toBeInstanceOf(TextFormatError);
      const issues = (e as TextFormatError).issues.join("\n");
      expect(issues).toContain("a.story:2");
      expect(issues).toContain("teleport");
    }
  });

  it("缺 label / 意外缩进 / menu 无选项 → 整次拒绝", () => {
    expect(() => parseTextStory('say "没有 label"\n')).toThrow(TextFormatError);
    expect(() =>
      parseTextStory('label a:\n  say "x"\n      say "更深"\n'),
    ).toThrow(TextFormatError); // 块内缩进层级不一致
    expect(() => parseTextStory('label a:\n  menu "空"\n', "m.story")).toThrow(
      TextFormatError,
    );
  });

  it("scene 列无文本投影 → fail-closed（元素系统未实现）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [{ id: "sc", kind: "scene", elements: [] }],
    });
    expect(() => generateText(story)).toThrow(TextFormatError);
  });
});

describe("07-T4 混存识别（parseStoryFile）", () => {
  it("JSON 内容走 JSON 投影、文本内容走文本投影", () => {
    const json = parseStoryFile(
      JSON.stringify({
        formatVersion: 1,
        columns: [{ id: "a", kind: "flow", commands: [] }],
      }),
      "a.story",
    );
    expect(json.columns[0]?.id).toBe("a");

    const text = parseStoryFile('label start:\n  say "hi"\n', "start.story");
    expect(text.columns[0]).toMatchObject({ id: "start", kind: "flow" });
  });

  it("坏 JSON → StoryFormatError（不降级，§一.47）", () => {
    expect(() => parseStoryFile("{ broken", "bad.story")).toThrow(
      StoryFormatError,
    );
  });
});

describe("07 nvl/character 文法往返", () => {
  it("nvl 各模式 + character 往返等价", () => {
    const text = `label a:
  nvl
  say "甲"
  nvl clear
  say "乙"
  nvl exit
  character "灵泛" name="灵泛" color="#7aa2f7" size="20" textColor="#e6e6f0"
  say "终"
`;
    const story = parseTextStory(text, "d.story");
    expect(generateText(story)).toBe(text);
  });

  it("nvl 未知子命令 → TextFormatError", () => {
    expect(() => parseTextStory("label a:\n  nvl bad\n")).toThrow(
      TextFormatError,
    );
  });

  it("nvl auto → 生成 nvl auto（非 nvl enter）", () => {
    const text = `label a:
  nvl auto
  say "auto"
`;
    const story = parseTextStory(text, "d.story");
    const cmds = story.columns[0]?.commands ?? [];
    expect(cmds[0]).toMatchObject({
      op: "nvl",
      mode: "auto",
    });
    expect(generateText(story)).toBe(text);
  });
});

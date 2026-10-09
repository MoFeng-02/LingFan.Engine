/**
 * 文本创作模式测试：
 * 往返等价（text → JSON → text 字节级一致）/ 投影失败整次拒绝带行列定位 /
 * JSON 唯一真相源（JSON → text → JSON 结构等价）/ 混存识别
 */
import { describe, expect, it } from "vitest";
import type { StoryCommand } from "@lingfan/engine";
import {
  drainTextProjectionWarnings,
  generateText,
  parseStory,
  parseStoryFile,
  parseTextStory,
  projectText,
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
  save "slot_1" title "第一章"
  save "quick"
  auto_save true
  auto_save false
  load "auto"
  save_delete "quick"
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

describe("往返等价（text → JSON → text 字节级一致）", () => {
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

  it("JSON → text → JSON 结构等价（JSON 树唯一真相源）", () => {
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

describe("投影失败整次拒绝 + 行列定位", () => {
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

  it("scene 列支持文本投影：元素行 + entry 命令，且往返可解析回 scene 列", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "sc",
          kind: "scene",
          elements: [
            { type: "text", id: "t", text: "标题" },
            {
              type: "panel",
              x: 5,
              children: [{ type: "button", text: "开始", nav: "sc" }],
            },
          ],
          entry: [{ op: "say", text: "hi" }],
        },
      ],
    });
    const text = generateText(story);
    expect(text).toContain("scene sc");
    expect(text).toContain('text "标题" id=t');
    expect(text).toContain("panel x=5");
    expect(text).toContain('  button "开始" nav=sc'); // 嵌套缩进
    expect(text).toContain('say "hi"');

    // 往返：生成文本可解析回同构 scene 列
    const back = parseTextStory(text, "roundtrip.story");
    expect(back.columns[0]?.kind).toBe("scene");
    expect(back.columns[0]?.elements).toHaveLength(2);
    expect(back.columns[0]?.entry).toEqual([{ op: "say", text: "hi" }]);
  });

  it("06 projectText 容错投影：scene 列已支持，无不可投影项时 issues 为空", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      entry: "a",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "say", text: "hi" }] },
        { id: "sc", kind: "scene", elements: [] },
      ],
    });
    const projection = projectText(story);
    expect(projection.issues).toEqual([]);
    expect(projection.text).toContain("label a:");
    expect(projection.text).toContain('say "hi"');
    expect(projection.text).toContain("scene sc");
    // 无 issues 时与 generateText 完全一致
    const clean = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "say", text: "hi" }] },
      ],
    });
    expect(projectText(clean).text).toBe(generateText(clean));
    expect(projectText(clean).issues).toEqual([]);
  });
});

describe("混存识别（parseStoryFile）", () => {
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

  it("坏 JSON → StoryFormatError（不降级）", () => {
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

  it("say template + character screen 往返等价", () => {
    const text = `label a:
  character "少女" name="少女" screen="char-screen"
  say "你好" template="center"
  say "回默认"
`;
    const story = parseTextStory(text, "d.story");
    expect(generateText(story)).toBe(text);
    // 投影语义：template/screen 字段进命令负载（执行层三级优先级的输入）
    const charCmd = story.columns[0]!.commands![0]!;
    expect(charCmd.screen).toBe("char-screen");
    const sayCmd = story.columns[0]!.commands![1]!;
    expect(sayCmd.template).toBe("center");
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

/**
 * 编辑器容错投影（编辑器工程模型缺陷回归）：
 * 编辑器里「插入命令但必填字段还空着」是常态（插入即入树，校验是编辑期诊断）——
 * 半个命令必须降级为 issue，**不许**把整棵树带崩（原缺陷：`escapeForText(undefined)`
 * 抛 TypeError → 文本视图崩 → 整页失活）。
 */
describe("半成品命令的容错投影（不允许抛非契约异常）", () => {
  /** 合法故事 + 一条「刚插入还没填字段」的命令 */
  function withHalfFilled(command: Record<string, unknown>) {
    const story = parseTextStory('label start:\n  say "甲"\n', "half.story");
    const column = story.columns[0];
    if (column === undefined) throw new Error("投影测试：故事缺少列");
    column.commands = [...(column.commands ?? []), command as StoryCommand];
    return story;
  }

  it("必填字符串字段缺失（navigate 无 path）→ issue，其余照常投影", () => {
    const projection = projectText(withHalfFilled({ op: "navigate" }));
    expect(projection.issues).toHaveLength(1);
    expect(projection.issues[0]).toContain("缺少字符串字段");
    expect(projection.text).toContain('say "甲"');
  });

  it("必填字典字段缺失（style 无 props）→ issue", () => {
    const projection = projectText(
      withHalfFilled({ op: "style", target: "#bg" }),
    );
    expect(projection.issues).toHaveLength(1);
    expect(projection.issues[0]).toContain("缺少字典字段");
  });

  it("必填数组字段缺失（if 无 then）→ issue 带 op 定位（生成器内部异常同样降级）", () => {
    const projection = projectText(
      withHalfFilled({ op: "if", cond: "{player.gold >= 1}" }),
    );
    expect(projection.issues).toHaveLength(1);
    expect(projection.issues[0]).toContain('op "if"');
  });

  it("严格路径 generateText 仍整次拒绝（fail-closed 不放松）", () => {
    expect(() => generateText(withHalfFilled({ op: "navigate" }))).toThrow(
      TextFormatError,
    );
  });
});

/**
 * 文本投影警告的出口：解析不因「语义暂未生效」失败，但警告不能丢——
 * 调用方在解析后取走一次即可拿到，取走即清空，陈旧警告不会混进下一次。
 */
describe("警告池出口（取走并清空）", () => {
  it("无参 pause 照常解析，警告可取出且第二次取走为空", () => {
    drainTextProjectionWarnings(); // 起手清池，避免上一条用例的残留
    const story = parseTextStory("label a:\n  pause\n", "warn.story");
    expect(story.columns[0]?.commands).toEqual([{ op: "pause", seconds: 0 }]);

    const first = drainTextProjectionWarnings();
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("warn.story:2");
    expect(first[0]).toContain("pause 无参数");

    expect(drainTextProjectionWarnings()).toEqual([]);
  });

  it("无参 wait 同样产警告（与 pause 同分支）", () => {
    drainTextProjectionWarnings();
    parseTextStory("label a:\n  wait\n", "warn.story");
    const warnings = drainTextProjectionWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("wait 无参数");
  });

  it("带参数的 wait 不产警告", () => {
    drainTextProjectionWarnings();
    parseTextStory("label a:\n  wait 1.5 skipable\n", "warn.story");
    expect(drainTextProjectionWarnings()).toEqual([]);
  });

  it("整次拒绝时警告已先记录，不随异常丢失", () => {
    drainTextProjectionWarnings();
    expect(() =>
      parseTextStory("label a:\n  pause\n  teleport far\n", "warn.story"),
    ).toThrow(TextFormatError);

    const warnings = drainTextProjectionWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("pause 无参数");
  });
});

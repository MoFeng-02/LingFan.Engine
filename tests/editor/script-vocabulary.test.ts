/**
 * Script 词汇层**互锁守卫**。
 *
 * 双射 = builder 覆盖集 ↔ `OP_SCHEMAS` keys 完全相等：新增 op 没进 builder（红）、
 * builder 产出未知 op 名（红）——词汇层与引擎 op 面零漂移的机器保障。
 * 形状抽测 + builder 旅程锁「产物真的是合法 Story 数据」。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generateText,
  parseStory,
  parseTextStory,
  type StoryCommand,
} from "@lingfan/engine";
import { OP_SCHEMAS } from "../../packages/editor/src/schema/opSchemas";
import * as script from "../../packages/editor/src/script";
import { SCRIPT_COVERAGE } from "../../packages/editor/src/script";

/** $ 前缀 = 辅助词（不直接产出独立 op），互锁比较时跳过 */
const directOps = new Set(
  Object.values(SCRIPT_COVERAGE).filter((op) => !op.startsWith("$")),
);

describe("词汇层全集互锁（builder ↔ op 双射）", () => {
  it("builder 覆盖集 = OP_SCHEMAS 全集（无遗漏、无越界）", () => {
    const schemas = new Set(Object.keys(OP_SCHEMAS));
    expect(directOps).toEqual(schemas);
  });

  it("每个登记项都有真实的 builder 函数（防登记与导出漂移）", () => {
    for (const [builderName, op] of Object.entries(SCRIPT_COVERAGE)) {
      if (op.startsWith("$")) continue;
      const fn = (script as unknown as Record<string, unknown>)[builderName];
      expect(typeof fn, `builder 缺失：${builderName} (${op})`).toBe("function");
    }
  });

  it("覆盖登记与源文件导出一致（SCRIPT_COVERAGE 不是孤岛清单）", () => {
    const indexSource = readFileSync(
      new URL("../../packages/editor/src/script/index.ts", import.meta.url),
      "utf8",
    );
    // 抓全部 `export { … }` 块的内容再按逗号拆（多行块首项没有前导逗号——
    // 单一 `,(\w+)` 口径会漏块首项）
    const exported = new Set<string>();
    for (const m of indexSource.matchAll(/export \{([^}]*)\}/g)) {
      for (const name of m[1]!.split(",")) {
        const trimmed = name.trim();
        if (trimmed !== "") exported.add(trimmed.replace(/^type /, ""));
      }
    }
    for (const builderName of Object.keys(SCRIPT_COVERAGE)) {
      expect(exported.has(builderName), `导出缺失：${builderName}`).toBe(true);
    }
  });
});

describe("词汇层 · 形状抽测（产物 = 合法 op 数据）", () => {
  it("when：then-only 最常用形态 ⇒ 干净 if-op 数据", () => {
    expect(script.when("{gold >= 25}", [script.say("充足")])).toEqual({
      op: "if",
      cond: "{gold >= 25}",
      then: [{ op: "say", text: "充足" }],
    });
  });

  it("whenChain 链式 ⇒ if-op 节点（then/elif/else 全分支）", () => {
    const cmd = script
      .whenChain("{gold >= 25}", [script.say("充足")])
      .elif("{gold >= 10}", [script.say("还行")])
      .else([script.say("穷")]);
    expect(cmd).toEqual({
      op: "if",
      cond: "{gold >= 25}",
      then: [{ op: "say", text: "充足" }],
      elif: [{ cond: "{gold >= 10}", then: [{ op: "say", text: "还行" }] }],
      else: [{ op: "say", text: "穷" }],
    });
  });

  it("guard 带 args ⇒ 参数原样入数据（JSON 安全口径由运行期校验）", () => {
    expect(script.guard("inventory-consistent", { args: { maxSlots: 8 } })).toEqual({
      op: "guard",
      fn: "inventory-consistent",
      args: { maxSlots: 8 },
    });
  });

  it("变量域 builder ⇒ 字段对齐 opSchemas 形状", () => {
    expect(script.newArray("bag", ["剑", 2], { once: true })).toEqual({
      op: "array",
      key: "bag",
      items: ["剑", 2],
      once: true,
    });
    expect(script.dictSet("bag", "slot1", "盾")).toEqual({
      op: "dict_set",
      key: "bag",
      field: "slot1",
      value: "盾",
    });
  });

  it("复合词 ⇒ 元素数组（sceneSetup 等价于「设置场景」）", () => {
    const [bg, title] = script.sceneSetup("Images/town.jpg", "小镇入口", {
      bgOpacity: 0.4,
    });
    expect(bg).toMatchObject({ type: "background", source: "Images/town.jpg" });
    expect(title).toMatchObject({ type: "text", text: "小镇入口", halign: "center" });
  });

  it("extOp：扩展 op 通用构造（负载展开在前，op 恒由首参决定）", () => {
    expect(script.extOp("quest", { step: 1, title: "任务" })).toEqual({
      op: "quest",
      step: 1,
      title: "任务",
    });
    expect(script.extOp("quest")).toEqual({ op: "quest" });
    // op 劫持防护：负载带 op 键也不得覆盖首参
    expect(script.extOp("quest", { op: "hijack" })).toEqual({ op: "quest" });
  });
});

describe("词汇层 · 扩展 op（extOp）", () => {
  const extStorySource = {
    formatVersion: 1,
    id: "ext-journey",
    entry: "start",
    columns: [
      {
        id: "start",
        kind: "flow" as const,
        commands: [script.extOp("quest", { step: 1 }), script.say("完成")],
      },
    ],
  };

  it("extOp 产物 ⇒ parseStory 接受（数据层放行：未知 op 结构从简、交执行器/构建期把守）", () => {
    const story = parseStory(extStorySource);
    expect(story.columns[0]!.commands).toContainEqual({ op: "quest", step: 1 });
  });

  it("未注册投影的扩展 op ⇒ 文本投影整次拒绝（fail-closed）", () => {
    const story = parseStory(extStorySource);
    expect(() => generateText(story)).toThrow(/quest/);
  });
});

describe("词汇层 · builder 旅程（第四形态入场）", () => {
  it("builder 组装的故事 ⇒ parseStory 接受 + 文本投影往返 + 回读深等", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "builder-journey",
      entry: "start",
      defines: { "player.gold": 30 },
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            script.say("welcome", "narr"),
            script.assert("{player.gold >= 25}", "金币校验"),
            script
              .whenChain("{player.gold >= 25}", [script.say("rich")])
              .else([script.say("poor")]),
            script.jump("epilogue"),
          ],
        },
        {
          id: "epilogue",
          kind: "flow",
          commands: [script.set("done", true), script.say("终")],
        },
      ],
    });
    const text = generateText(story);
    expect(text).toContain("assert {player.gold >= 25}");
    expect(text).toContain("if {player.gold >= 25}");
    const reparsed = parseTextStory(text);
    expect(reparsed.columns).toEqual(story.columns);
  });
});

/**
 * **全 builder ⇄ parseStory 可解析互锁**：双射互锁只锁「op 名」，
 * 锁不住「产物形状」——forEach 漏 key / pause 缺 seconds / arrayPush 产 items 三连
 * 都是 op 名对、形状错 ⇒ 双射绿而 parseStory 红。本测试把**每个** direct builder 的
 * 最小合法产物喂给真 parseStory：今后任何 builder 形状漂移都在这里红，而非用户工程里。
 */
describe("词汇层 · 全 builder 可解析守卫（形状漂移零容忍）", () => {
  /** 每个 direct builder 的最小合法产物（参数按格式层契约取最小值） */
  const samples: ReadonlyArray<readonly [string, StoryCommand]> = [
    ["say", script.say("文本")],
    ["menu", script.menu("去哪", [script.option("a", "b")])],
    ["input", script.input("名字？", "player.name")],
    ["notify", script.notify("提示")],
    ["nvl", script.nvl("enter")],
    ["character", script.character("灵泛", { name: "灵泛" })],
    ["wait", script.wait(1)],
    ["pause", script.pause(1)],
    ["random", script.random(7, 1, 6, "dice")],
    ["jump", script.jump("somewhere")],
    ["navigate", script.navigate("somewhere")],
    ["func", script.func("greet", ["who"], [script.ret()])],
    ["call", script.call("greet")],
    ["ret", script.ret()],
    ["when", script.when("{x}", [script.say("y")])],
    ["whileDo", script.whileDo("{x}", [script.say("y")])],
    ["forIn", script.forIn("i", "{arr}", [script.say("{i}")])],
    ["forEach", script.forEach("item", "arr", [script.say("{item}")])],
    [
      "switchOn",
      script.switchOn("{x}", [[1, [script.say("一")]]], [script.say("其他")]),
    ],
    ["breakLoop", script.breakLoop()],
    ["continueLoop", script.continueLoop()],
    ["assert", script.assert("{x >= 0}", "校验")],
    ["guard", script.guard("g", { args: { a: 1 } })],
    ["set", script.set("k", 1)],
    ["define", script.define("k", 1)],
    ["letVar", script.letVar("k", 1)],
    ["localVar", script.localVar("k", 1)],
    ["undef", script.undef("k")],
    ["newArray", script.newArray("arr", [1, "a"], { once: true })],
    ["arrayPush", script.arrayPush("arr", "x")],
    ["arrayPop", script.arrayPop("arr")],
    ["dict", script.dict("d", { a: 1 })],
    ["dictSet", script.dictSet("d", "a", 2)],
    ["save", script.save("s1", "标题")],
    ["load", script.load("s1")],
    ["autoSave", script.autoSave(true)],
    ["saveDelete", script.saveDelete("s1")],
    ["bgm", script.bgm("Audio/a.mp3", { volume: 0.5 })],
    ["stopBgm", script.stopBgm()],
    ["se", script.se("Audio/a.mp3")],
    ["ambient", script.ambient("Audio/a.mp3")],
    ["stopAmbient", script.stopAmbient()],
    ["voice", script.voice("Audio/a.mp3", { autoStop: true })],
    ["stopVoice", script.stopVoice()],
    ["video", script.video("Video/a.mp4")],
    ["cutscene", script.cutscene("Video/a.mp4", { skipable: true })],
    ["seekVideo", script.seekVideo(1)],
    ["pauseVideo", script.pauseVideo()],
    ["resumeVideo", script.resumeVideo()],
    ["stopVideo", script.stopVideo()],
    ["videoSkipable", script.videoSkipable(true)],
    [
      "minigame",
      script.minigame("click3", {
        config: { target: 3 },
        reward: [script.reward("player.gold", 1)],
      }),
    ],
    [
      "interaction",
      script.interaction("walk", {
        config: { target: 120 },
        onSuccess: "arrived",
      }),
    ],
    ["show", script.show("Images/a.png", { x: 1, y: 2 })],
    ["hide", script.hide("hero")],
    ["background", script.background("Images/a.png")],
    ["bgSwitch", script.bgSwitch("Images/a.png")],
    ["setZ", script.setZ("hero", 5)],
    ["style", script.style("hero", { opacity: 0.5 })],
    ["dialogWindow", script.dialogWindow("hide")],
    ["animate", script.animate("hero", "opacity", 0.5, { duration: 1 })],
    ["animateBlock", script.animateBlock("hero", { x: 3, duration: 1 })],
    ["transition", script.transition("fade", 0.5)],
    ["shake", script.shake({ intensity: 5 })],
    ["textTypewriter", script.textTypewriter({ enabled: false })],
  ];

  it("direct builder 数 = OP_SCHEMAS 数（采样表不漏不越）", () => {
    expect(samples).toHaveLength(directOps.size);
  });

  it("每个 builder 的最小产物都能被 parseStory 接受（逐列独立定位）", () => {
    const columns = samples.map(([, cmd], i) => ({
      id: `c${i}`,
      kind: "flow" as const,
      commands: [cmd],
    }));
    const story = parseStory({
      formatVersion: 1,
      id: "vocab-parity",
      entry: "c0",
      columns,
    });
    expect(story.columns).toHaveLength(samples.length);
  });
});

/**
 * 实例级 z 通道测试。
 * - 三级优先（实例 > 层默认 > 内建）：本文件测前半段「实例进 SSOT / 缺省回默认」
 * - 层映射（say→dialogue、menu/input→choices、notify→notifications、minigame→minigame）
 * - fail-closed（解析期 + 执行期双闸；非法值不动状态）
 * - 随快照/回溯自动随行
 * 契约事实：命令上的 `z` 只对**拥有独立渲染层**的 op 有效；元素实例 z 走 `ElementInstance.z`（另一条路）。
 */
import { describe, expect, it } from "vitest";
import type { Story } from "@lingfan/engine";
import {
  SYS,
  StoryEngine,
  generateText,
  parseStory,
  parseTextStory,
} from "@lingfan/engine";

interface Harness {
  engine: StoryEngine;
  errors: string[];
  dispose: () => void;
}

/** 直构（**绕过** parseStory 深校验）——用于测执行器自身的纵深防御 */
function rawStory(columns: object[], entry = "a"): Story {
  return { formatVersion: 1, id: "t", entry, columns } as unknown as Story;
}

function makeEngine(story: Story): Harness {
  const engine = new StoryEngine(story);
  const errors: string[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
  });
  return {
    engine,
    errors,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

function makeHarness(columns: object[], entry = "a"): Harness {
  return makeEngine(parseStory({ formatVersion: 1, id: "t", entry, columns }));
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

function say(text: string, z?: number): object {
  return z === undefined ? { op: "say", text } : { op: "say", text, z };
}

describe("实例级 z：进 SSOT 与「只影响这一个」", () => {
  it("带 z 的 say 写入实例键；下一条不带 z 的 say 清除 → 回层默认（核心语义）", () => {
    const h = makeHarness([column("a", [say("一", 20), say("二")])]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogueZ)).toBe(20); // 本句实例 z
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    h.engine.advance();
    // 下一条没写 z → 键被清除（不是沿用 20）——「不影响其他没有覆盖的 say」
    expect(h.engine.get(SYS.dialogueZ)).toBeUndefined();
    expect(h.engine.get(SYS.currentDialogText)).toBe("二");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });

  it("clear 也发事件（宿主据此回层默认，不会停在旧覆盖上）", () => {
    const h = makeHarness([column("a", [say("一", 20), say("二")])]);
    const seen: Array<[string, unknown]> = [];
    const off = h.engine.onStateChanged(({ key, value }) => {
      if (key === SYS.dialogueZ) seen.push([key, value]);
    });
    h.engine.start();
    h.engine.advance();
    expect(seen).toEqual([
      [SYS.dialogueZ, 20],
      [SYS.dialogueZ, undefined],
    ]);
    off();
    h.dispose();
  });
});

describe("实例级 z：层映射", () => {
  it("menu / input → choices 层", () => {
    const menu = makeHarness([
      column("a", [
        say("一"),
        { op: "menu", prompt: "选", options: [{ text: "走", target: "a" }], z: 7 },
      ]),
    ]);
    menu.engine.start();
    menu.engine.advance();
    expect(menu.engine.get(SYS.waiting)).toBe("menu");
    expect(menu.engine.get(SYS.choicesZ)).toBe(7);
    expect(menu.engine.get(SYS.dialogueZ)).toBeUndefined(); // 不串层
    menu.dispose();

    const input = makeHarness([
      column("a", [say("一"), { op: "input", prompt: "名", store: "n", z: 8 }]),
    ]);
    input.engine.start();
    input.engine.advance();
    expect(input.engine.get(SYS.waiting)).toBe("input");
    expect(input.engine.get(SYS.choicesZ)).toBe(8);
    input.dispose();
  });

  it("notify → notifications 层（非等待 op：不影响后续对话的 z）", () => {
    const h = makeHarness([
      column("a", [
        say("一"),
        { op: "notify", text: "提示", z: 50 },
        say("二"),
      ]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.engine.get(SYS.notificationsZ)).toBe(50);
    expect(h.engine.get(SYS.dialogueZ)).toBeUndefined();
    expect(h.engine.get(SYS.currentDialogText)).toBe("二");
    h.dispose();
  });

  it("minigame → minigame 层", () => {
    const h = makeHarness([
      column("a", [say("一"), { op: "minigame", game: "g", z: 9 }]),
    ]);
    h.engine.start();
    h.engine.advance();
    expect(h.engine.get(SYS.waiting)).toBe("minigame");
    expect(h.engine.get(SYS.minigameZ)).toBe(9);
    h.dispose();
  });

  it("video / cutscene → video 层（宿主解析后交 VideoPort.setZIndex）", () => {
    // video 是**非等待** op（发播放命令即继续）；cutscene 才进等待态
    const video = makeHarness([
      column("a", [{ op: "video", resource: "Video/x.mp4", z: 120 }]),
    ]);
    video.engine.start();
    expect(video.engine.get(SYS.videoZ)).toBe(120);
    expect(video.engine.get(SYS.dialogueZ)).toBeUndefined(); // 不串层
    video.dispose();

    const cutscene = makeHarness([
      column("a", [{ op: "cutscene", resource: "Video/x.mp4", z: 130 }]),
    ]);
    cutscene.engine.start();
    expect(cutscene.engine.get(SYS.waiting)).toBe("video");
    expect(cutscene.engine.get(SYS.videoZ)).toBe(130);
    cutscene.dispose();
  });

  it("video 层同样「下一条不带 z 即回默认」（以 cutscene 演示等待序列）", () => {
    const h = makeHarness([
      column("a", [
        { op: "cutscene", resource: "Video/a.mp4", z: 120 },
        { op: "cutscene", resource: "Video/b.mp4" },
      ]),
    ]);
    h.engine.start();
    expect(h.engine.get(SYS.waiting)).toBe("video");
    expect(h.engine.get(SYS.videoZ)).toBe(120);
    h.engine.videoFinished(); // 解除过场等待 → 下一条 cutscene
    expect(h.engine.get(SYS.waiting)).toBe("video");
    expect(h.engine.get(SYS.videoZ)).toBeUndefined(); // 未指定 → 删键回层默认
    h.dispose();
  });
});

describe("实例级 z：fail-closed", () => {
  it("解析期拒绝：负数 / 字符串 / NaN / Infinity", () => {
    for (const bad of [-1, "20", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => parseStory({ formatVersion: 1, id: "t", entry: "a", columns: [column("a", [say("一", bad as number)])] }),
        String(bad),
      ).toThrow(/z 必须为非负有限数/);
    }
  });

  it("执行期防御：绕过解析直构 → engine.error 且不动状态", () => {
    // 直构 Story（不经 parseStory 的深校验）——执行器必须自己守住
    const h = makeEngine(rawStory([column("a", [say("一", -5), say("二")])]));
    h.engine.start();
    expect(h.errors).toContain("instance-z-invalid");
    expect(h.engine.get(SYS.dialogueZ)).toBeUndefined(); // 未写实例键
    expect(h.engine.get(SYS.currentDialogText)).toBeUndefined(); // 状态原样（未上屏）
    // fail-closed = 停在该命令（不静默跳过、也不带病前进）；与 say-invalid 同语义
    expect(h.engine.get(SYS.waiting)).not.toBe("dialog"); // 未建立对话等待
    h.dispose();
  });

  it("元素实例 z 不走本通道（契约边界：两边互不干扰）", () => {
    // say 的 z 只影响该层；元素 z 由 ElementInstance.z 承担（舞台内部叠放）
    const h = makeHarness([column("a", [say("一", 3)])]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogueZ)).toBe(3);
    expect(h.engine.get(SYS.elements)).toEqual([]); // 未进 scene 列 = 元素层空（初值数组）
    h.dispose();
  });
});

describe("实例级 z：随快照 / 回溯", () => {
  it("回退到带 z 的检查点 → 实例 z 随快照恢复", () => {
    const h = makeHarness([column("a", [say("一", 20), say("二")])]);
    h.engine.start();
    expect(h.engine.get(SYS.dialogueZ)).toBe(20);
    h.engine.advance();
    expect(h.engine.get(SYS.dialogueZ)).toBeUndefined();
    h.engine.back(); // 回退到「一」（检查点携带当时的 state）
    expect(h.engine.get(SYS.currentDialogText)).toBe("一");
    expect(h.engine.get(SYS.dialogueZ)).toBe(20);
    h.dispose();
  });
});

describe("实例级 z：文本投影往返", () => {
  const json = {
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns: [
      column("a", [
        say("一", 20),
        { op: "menu", prompt: "选", options: [{ text: "走", target: "a" }], z: 7 },
        { op: "input", prompt: "名", store: "n", z: 8 },
        { op: "notify", text: "提示", z: 50 },
        { op: "minigame", game: "g", z: 9 },
        { op: "video", resource: "Video/x.mp4", z: 120 },
        { op: "cutscene", resource: "Video/y.mp4", skipable: true, z: 130 },
      ]),
    ],
  };

  it("生成 → 解析：七个 op 的 z 都不丢（含 menu prompt 不被污染）", () => {
    const story = parseStory(json);
    const text = generateText(story);
    expect(text).toContain('say "一" z=20');
    expect(text).toContain('menu "选" z=7');
    expect(text).toContain('input "名" store="n" z=8');
    expect(text).toContain('notify "提示" z=50');
    expect(text).toContain('minigame "g" z=9');
    expect(text).toContain('video "Video/x.mp4" z=120');
    expect(text).toContain('cutscene "Video/y.mp4" skipable=true z=130');
    // 解析回来结构等价（JSON 树唯一真相源）
    expect(parseTextStory(text, "t")).toEqual(story);
  });

  it("别名 z-index= 解析等价（需求里就是这么写的）；无 z 时文本不含 z=", () => {
    const withAlias = parseTextStory('label a:\n  say "一" z-index=20\n', "t");
    expect(withAlias.columns[0]).toMatchObject({
      commands: [{ op: "say", text: "一", z: 20 }],
    });
    const plain = generateText(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [column("a", [say("一")])],
      }),
    );
    expect(plain).not.toContain("z="); // 未指定不输出（既有文本逐字节稳定）
  });
});

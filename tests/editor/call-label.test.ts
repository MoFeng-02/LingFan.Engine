/**
 * `call <label>`（调用子过程：**列目标**）守卫。
 *
 * **语义权威**：`call` 的文档语义是「调用子过程（**func 或 label**），用 return 返回」。
 * 只认 func 时，`call sb_subroutine`（`label sb_subroutine:` 定义）
 * 会报「调用未注册的函数」。
 *
 * **实现语义**（要点）：
 * - `call <列>` **直接压入该列命令的帧**（不切 `coord`、不装元素）——
 *   它调用的是**子过程**（代码块），不是「进入新场景」（那是 navigate/jump）
 * - 作用域 = **块级**（`enterChild`，不污染列级作用域）
 * - 返回两条路径都通：**① 显式 `return` ② 列尾出帧**（帧耗尽即回到调用点）
 */
import { describe, expect, it } from "vitest";
import {
  SYS,
  StoryEngine,
  parseStory,
  type OutboundEvent,
} from "@lingfan/engine";
import { analyzeStory } from "@lingfan/editor";

function instrument(engine: StoryEngine) {
  const errors: OutboundEvent[] = [];
  const off = engine.onEvent((e) => errors.push(e));
  return { engine, errors, dispose: off };
}

function errCode(e: OutboundEvent | undefined): string | undefined {
  return (e as { payload?: { code?: string } } | undefined)?.payload?.code;
}

/** 主列调用子过程列（子过程用 `return` 或自然结束） */
function callStory(subCommands: object[]) {
  return parseStory({
    formatVersion: 1,
    id: "t",
    entry: "main",
    columns: [
      {
        id: "main",
        kind: "flow",
        commands: [
          { op: "say", text: "before" },
          { op: "call", target: "sub" },
          { op: "say", text: "after" },
        ],
      },
      { id: "sub", kind: "flow", commands: subCommands },
    ],
  });
}

describe("call <label> · 调用与返回", () => {
  it("**`call <列>` 真能进入子过程**", () => {
    const h = instrument(new StoryEngine(callStory([
      { op: "say", text: "in-sub" },
      { op: "return" },
    ])));
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("before");
    h.engine.advance();
    // 核心判据：进到子过程里了
    expect(h.engine.get(SYS.currentDialogText)).toBe("in-sub");
    h.dispose();
  });

  it("**`return` 回到调用点的下一条**", () => {
    const h = instrument(new StoryEngine(callStory([
      { op: "say", text: "in-sub" },
      { op: "return" },
    ])));
    h.engine.start();
    h.engine.advance(); // before → in-sub
    h.engine.advance(); // in-sub → return → after
    expect(h.engine.get(SYS.currentDialogText)).toBe("after");
    h.dispose();
  });

  it("**无 `return` 时列尾自动返回**（子过程可以不写 return）", () => {
    const h = instrument(new StoryEngine(callStory([
      { op: "say", text: "in-sub" },
    ])));
    h.engine.start();
    h.engine.advance(); // before → in-sub
    h.engine.advance(); // 列尾 → 回到 after
    expect(h.engine.get(SYS.currentDialogText)).toBe("after");
    h.dispose();
  });

  it("**`call <func>` 不受影响**（既有能力未被破坏）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "main",
      columns: [
        {
          id: "main",
          kind: "flow",
          commands: [
            { op: "func", name: "fx", params: [], body: [{ op: "say", text: "in-func" }] },
            { op: "call", target: "fx" },
            { op: "say", text: "after-func" },
          ],
        },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("in-func");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("after-func");
    h.dispose();
  });

  it("**嵌套 call**（子过程再调子过程）⇒ 逐层正确返回", () => {
    // 不测「变量污染」：`let` 是**块级**（不进全局状态），
    //     用 `engine.get` 读不到它 —— 那是作用域语义（既有测试覆盖），
    //     这里测**调用栈深度**：三层嵌套的返回顺序。
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "main",
      columns: [
        { id: "main", kind: "flow", commands: [
          { op: "call", target: "lvl1" },
          { op: "say", text: "M" },
        ] },
        { id: "lvl1", kind: "flow", commands: [
          { op: "call", target: "lvl2" },
          { op: "say", text: "L1" },
        ] },
        { id: "lvl2", kind: "flow", commands: [
          { op: "say", text: "L2" },
          { op: "return" },
        ] },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("L2"); // 最深先执行
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("L1"); // 回第一层
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("M"); // 回主流程
    h.dispose();
  });
});

describe("call <label> · 失败路径（语义明确）", () => {
  it("**目标既不是列也不是 func ⇒ `call-unknown-target`**", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "main",
      columns: [
        { id: "main", kind: "flow", commands: [{ op: "call", target: "ghost" }] },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    expect(errCode(h.errors[0])).toBe("call-unknown-target");
    h.dispose();
  });

  it("**scene 列 ⇒ `call-invalid-target`**（空间层该用 navigate，不静默）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "main",
      columns: [
        { id: "main", kind: "flow", commands: [{ op: "call", target: "stage" }] },
        { id: "stage", kind: "scene", elements: [], entry: [] },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    expect(errCode(h.errors[0])).toBe("call-invalid-target");
    h.dispose();
  });
});

describe("call <label> · 编辑器诊断（两层同口径）", () => {
  it("**`call` 到存在的列 ⇒ 零诊断**", () => {
    const diagnostics = analyzeStory(callStory([{ op: "say", text: "x" }]));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("`call` 到存在的 func ⇒ 零诊断", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "main",
      columns: [
        {
          id: "main",
          kind: "flow",
          commands: [
            { op: "func", name: "fx", params: [], body: [] },
            { op: "call", target: "fx" },
          ],
        },
      ],
    });
    expect(analyzeStory(story).filter((d) => d.severity === "error")).toEqual([]);
  });

  it("`call` 到不存在 ⇒ `missing-target`（通用「目标不存在」）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "t",
      entry: "main",
      columns: [
        { id: "main", kind: "flow", commands: [{ op: "call", target: "ghost" }] },
      ],
    });
    const errs = analyzeStory(story).filter((d) => d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0]?.code).toBe("missing-target");
    expect(errs[0]?.message).toContain("既不是 func 也不是列");
  });
});

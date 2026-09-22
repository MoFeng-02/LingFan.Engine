/**
 * 02-执行模型测试（规约↔测试互锁锚点）：
 * ssot-only-observation / race-stale-complete-flag / reset-clickable-after-say /
 * advance-only-in-dialog-wait / unknown-op-fail-closed / choice-unknown-fails /
 * define-once-vs-let / scope-nested-lifetime / goto-unknown-column-fails
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutboundEvent, ValueChanged } from "./contracts";
import { SYS } from "./contracts";
import { StoryEngine } from "./engine";
import { parseStory } from "./format";

interface Harness {
  engine: StoryEngine;
  changes: ValueChanged[];
  errors: OutboundEvent[];
  dispose: () => void;
}

function instrument(engine: StoryEngine): Harness {
  const changes: ValueChanged[] = [];
  const errors: OutboundEvent[] = [];
  const offState = engine.onStateChanged((c) => changes.push(c));
  const offEvent = engine.onEvent((e) => errors.push(e));
  return {
    engine,
    changes,
    errors,
    dispose: () => {
      offState();
      offEvent();
    },
  };
}

function makeEngine(
  commands: object[],
  defines?: Record<string, unknown>,
): Harness {
  const json: unknown = {
    formatVersion: 1,
    id: "demo",
    ...(defines === undefined ? {} : { defines }),
    columns: [{ id: "start", kind: "flow", commands }],
  };
  return instrument(new StoryEngine(parseStory(json)));
}

function errorPayload(event: OutboundEvent | undefined): {
  code: string;
  message: string;
} {
  if (event === undefined || event.payload.kind !== "engine.error") {
    throw new Error(
      `期望 engine.error，实际：${JSON.stringify(event?.payload)}`,
    );
  }
  return { code: event.payload.code, message: event.payload.message };
}

function hasError(errors: OutboundEvent[], code: string): boolean {
  return errors.some(
    (e) => e.payload.kind === "engine.error" && e.payload.code === code,
  );
}

describe("最小闭环主链路（锚点: ssot-only-observation）", () => {
  it("start + advance×3 走完三句 say，StateChanged 键序列精确匹配", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "say", speaker: "灵泛", text: "第一句" },
      { op: "say", text: "第二句" },
      { op: "say", speaker: "灵泛", text: "第三句" },
    ]);
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance();

    const expectedKeys = [
      SYS.currentSceneColumn,
      // say 1（进入等待前清残留完成标记——锚点: race-stale-complete-flag）
      SYS.dialogComplete,
      SYS.currentDialogSpeaker,
      SYS.currentDialogText,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // advance 1（离开等待后清 clickable/noskip——锚点: reset-clickable-after-say）
      SYS.dialogComplete,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // say 2
      SYS.dialogComplete,
      SYS.currentDialogSpeaker,
      SYS.currentDialogText,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // advance 2
      SYS.dialogComplete,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // say 3
      SYS.dialogComplete,
      SYS.currentDialogSpeaker,
      SYS.currentDialogText,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
      // advance 3 → 列尾
      SYS.dialogComplete,
      SYS.dialogClickable,
      SYS.dialogNoskip,
      SYS.waiting,
    ];
    expect(changes.map((c) => c.key)).toEqual(expectedKeys);

    // 值抽查
    expect(changes[0]).toEqual({
      key: SYS.currentSceneColumn,
      value: "start",
      scope: "system",
    });
    expect(changes[2]?.value).toBe("灵泛");
    expect(changes[3]?.value).toBe("第一句");
    // say 2 无 speaker → 清空，不残留上一句
    expect(changes[12]?.key).toBe(SYS.currentDialogSpeaker);
    expect(changes[12]?.value).toBe("");
    expect(changes[13]?.value).toBe("第二句");
    // 末次 advance 后回到 none
    expect(changes[changes.length - 1]).toEqual({
      key: SYS.waiting,
      value: "none",
      scope: "system",
    });
    dispose();
  });

  it("say 进入等待时把残留的 __dialog_complete 清回 false（锚点: race-stale-complete-flag）", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    const firstWaitIdx = changes.findIndex((c) => c.key === SYS.waiting);
    engine.advance();
    // advance 置 complete=true 之后、下一句文本写入之前，必须有 complete=false 的清标记事件
    const afterAdvance = changes.slice(firstWaitIdx + 1);
    const completeTrueIdx = afterAdvance.findIndex(
      (c) => c.key === SYS.dialogComplete,
    );
    const staleClearIdx = afterAdvance.findIndex(
      (c) => c.key === SYS.dialogComplete && c.value === false,
    );
    const textIdx = afterAdvance.findIndex(
      (c) => c.key === SYS.currentDialogText,
    );
    expect(completeTrueIdx).toBeGreaterThanOrEqual(0);
    expect(staleClearIdx).toBeGreaterThan(completeTrueIdx);
    expect(textIdx).toBeGreaterThan(staleClearIdx);
    dispose();
  });

  it("离开 say 等待后 clickable/noskip 复位（锚点: reset-clickable-after-say）", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "say", text: "甲", clickable: true, noskip: true },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    expect(engine.get(SYS.dialogClickable)).toBe(true);
    expect(engine.get(SYS.dialogNoskip)).toBe(true);
    engine.advance();
    expect(engine.get(SYS.dialogClickable)).toBe(false);
    expect(engine.get(SYS.dialogNoskip)).toBe(false);
    // 第二句未声明 → 保持 false，无泄漏
    expect(
      changes.filter((c) => c.key === SYS.dialogNoskip).at(-1)?.value,
    ).toBe(false);
    dispose();
  });
});

describe("命令面守卫（锚点: advance-only-in-dialog-wait）", () => {
  it("未启动时 advance 无效并报错", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "甲" }]);
    engine.advance();
    expect(errorPayload(errors[0]).code).toBe("advance-invalid");
    dispose();
  });

  it("列尾（故事段结束）advance 无效并报错", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "甲" }]);
    engine.start();
    engine.advance(); // 走完唯一一句 → 列尾
    engine.advance();
    expect(errorPayload(errors.at(-1)).code).toBe("advance-invalid");
    dispose();
  });
});

describe("fail-closed（锚点: unknown-op-fail-closed）", () => {
  it("未知 op → engine.error，不静默执行也不崩溃", () => {
    const { engine, changes, errors, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "teleport", target: " nowhere" },
    ]);
    engine.start();
    engine.advance();
    const payload = errorPayload(errors[0]);
    expect(payload.code).toBe("unknown-op");
    expect(payload.message).toContain("teleport");
    expect(errors[0]?.v).toBe(1);
    expect(errors[0]?.payload.kind).toBe("engine.error");
    expect(engine.get(SYS.waiting)).toBe("none");
    // 未知 op 未产生任何状态写入
    expect(changes.filter((c) => c.key === "__teleport_target")).toHaveLength(
      0,
    );
    dispose();
  });

  it("say 负载未知字段 → engine.error 且零副作用", () => {
    const { engine, changes, errors, dispose } = makeEngine([
      { op: "say", text: "甲", hacker: true },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("say-unknown-field");
    // 先校验后写入：除列坐标外无任何对话键写入
    expect(changes.map((c) => c.key)).toEqual([SYS.currentSceneColumn]);
    expect(engine.get(SYS.currentDialogText)).toBeUndefined();
    dispose();
  });
});

describe("defines（01 §一.6：顶层无条件 Set）", () => {
  it("start 时 defines 按序写入且先于列坐标，scope=global", () => {
    const { engine, changes, dispose } = makeEngine(
      [{ op: "say", text: "甲" }],
      {
        "player.gold": 100,
        "npc.trust": 3,
      },
    );
    engine.start();
    expect(changes[0]).toEqual({
      key: "player.gold",
      value: 100,
      scope: "global",
    });
    expect(changes[1]).toEqual({ key: "npc.trust", value: 3, scope: "global" });
    expect(changes[2]?.key).toBe(SYS.currentSceneColumn);
    dispose();
  });
});

describe("重复 start", () => {
  it("第二次 start 报 already-started，不重置坐标", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "甲" }]);
    engine.start();
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("already-started");
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
    dispose();
  });
});

describe("入口列（01 §一.7）", () => {
  it("start 从 story.entry 列开始而非首列", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "say", text: "A" }] },
        { id: "b", kind: "flow", commands: [{ op: "say", text: "B" }] },
      ],
      entry: "b",
    });
    const { engine, dispose } = instrument(new StoryEngine(story));
    engine.start();
    expect(engine.get(SYS.currentSceneColumn)).toBe("b");
    expect(engine.get(SYS.currentDialogText)).toBe("B");
    dispose();
  });
});

describe("变量与作用域（S1/S2，老规范 §6.2）", () => {
  it("set 表达式值落全局，ValueChanged scope=global", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "set", key: "player.gold", value: "{100 + 20}" },
      { op: "say", text: "ok" },
    ]);
    engine.start();
    const gold = changes.find((c) => c.key === "player.gold");
    expect(gold).toMatchObject({ value: 120, scope: "global" });
    dispose();
  });

  it("set 复合赋值 +=", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "gold", value: 10 },
      { op: "set", key: "gold", value: "+= {5}" },
      { op: "say", text: "{gold}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("15");
    dispose();
  });

  it("define = 全局 once：已存在不覆盖（S2 define-once-vs-let）", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "define", key: "player.gold", value: 5 },
        { op: "say", text: "{player.gold}" },
      ],
      { "player.gold": 100 },
    );
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("100");
    dispose();
  });

  it("define 新键正常写入", () => {
    const { engine, dispose } = makeEngine([
      { op: "define", key: "gold", value: 9 },
      { op: "say", text: "{gold}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("9");
    dispose();
  });

  it("let = 块级：出块销毁（S1 scope-nested-lifetime）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        op: "if",
        cond: "{true}",
        then: [
          { op: "let", key: "tmp", value: 1 },
          { op: "say", text: "inside" },
        ],
      },
      { op: "say", text: "{tmp}" },
    ]);
    engine.start();
    engine.advance();
    // 出块后 {tmp} 未定义 → S8 保留原文 + error
    expect(engine.get(SYS.currentDialogText)).toBe("{tmp}");
    expect(hasError(errors, "unknown-variable")).toBe(true);
    dispose();
  });

  it("set 写入声明时所在层：块内 set 改列级 let（S1）", () => {
    const { engine, dispose } = makeEngine([
      { op: "let", key: "x", value: 1 },
      { op: "if", cond: "{x > 0}", then: [{ op: "set", key: "x", value: 2 }] },
      { op: "say", text: "{x}" },
    ]);
    engine.start();
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("2");
    dispose();
  });

  it("undef 沿声明链销毁；对未定义键 fail-closed", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "define", key: "g", value: 1 },
      { op: "undef", key: "g" },
      { op: "say", text: "{g}" },
    ]);
    engine.start();
    expect(hasError(errors, "unknown-variable")).toBe(true);
    expect(engine.get(SYS.currentDialogText)).toBe("{g}");
    dispose();

    const h2 = makeEngine([
      { op: "undef", key: "ghost" },
      { op: "say", text: "s" },
    ]);
    h2.engine.start();
    expect(errorPayload(h2.errors[0]).code).toBe("unknown-variable");
    h2.dispose();
  });
});

describe("分支与跳转（老规范 §6.1）", () => {
  it("if/else 分支选择", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "if",
        cond: "{1 < 2}",
        then: [{ op: "say", text: "then" }],
        else: [{ op: "say", text: "else" }],
      },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("then");
    dispose();
  });

  it("elif 链命中第二项", () => {
    const { engine, dispose } = makeEngine([
      {
        op: "if",
        cond: "{1 > 2}",
        then: [{ op: "say", text: "a" }],
        elif: [
          { cond: "{2 > 3}", then: [{ op: "say", text: "b" }] },
          { cond: "{3 > 2}", then: [{ op: "say", text: "c" }] },
        ],
        else: [{ op: "say", text: "d" }],
      },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("c");
    dispose();
  });

  it("cond 非 boolean → eval-type-error 停机（S5）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "if", cond: "{1 + 1}", then: [{ op: "say", text: "x" }] },
      { op: "say", text: "after" },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("eval-type-error");
    expect(engine.get(SYS.currentDialogText)).toBeUndefined();
    dispose();
  });

  it("F1：jump 目标不存在 → fail-closed（锚点: goto-unknown-column-fails）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "s" },
            { op: "jump", target: "nowhere" },
          ],
        },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    h.engine.advance();
    expect(errorPayload(h.errors.at(-1)).code).toBe("unknown-column");
    h.dispose();
  });

  it("jump 成功：切列 + 块级作用域销毁（S1）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "demo",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            {
              op: "if",
              cond: "{true}",
              then: [{ op: "let", key: "tmp", value: 1 }],
            },
            { op: "jump", target: "second" },
          ],
        },
        {
          id: "second",
          kind: "flow",
          commands: [{ op: "say", text: "{tmp}" }],
        },
      ],
    });
    const { engine, errors, dispose } = instrument(new StoryEngine(story));
    engine.start();
    expect(hasError(errors, "unknown-variable")).toBe(true);
    expect(engine.get(SYS.currentSceneColumn)).toBe("second");
    dispose();
  });
});

describe("menu/choose（02 §二.2/三.3，U8/E6；01 §一.2 选择即跳转目标列）", () => {
  /** start: say → menu(inn/square)；两目标列各一句 say */
  function makeMenuStory(): Harness {
    const story = parseStory({
      formatVersion: 1,
      id: "m",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "before" },
            {
              op: "menu",
              prompt: "去哪",
              options: [
                { text: "酒馆", target: "inn" },
                { text: "广场", target: "square" },
              ],
            },
          ],
        },
        { id: "inn", kind: "flow", commands: [{ op: "say", text: "酒馆线" }] },
        {
          id: "square",
          kind: "flow",
          commands: [{ op: "say", text: "广场线" }],
        },
      ],
    });
    return instrument(new StoryEngine(story));
  }

  it("进入菜单等待：写菜单键 + 清对话残留（08 §二.6）", () => {
    const { engine, dispose } = makeMenuStory();
    engine.start();
    engine.advance();
    expect(engine.get(SYS.waiting)).toBe("menu");
    expect(engine.get(SYS.menuPrompt)).toBe("去哪");
    expect(engine.get(SYS.menuOptions)).toEqual(["酒馆", "广场"]);
    expect(engine.get(SYS.menuTargets)).toEqual(["inn", "square"]);
    expect(engine.get(SYS.menuSelected)).toBe(-1);
    expect(engine.get(SYS.currentDialogText)).toBe("");
    expect(engine.get(SYS.dialogClickable)).toBe(false);
    dispose();
  });

  it("choose → selected 更新并跳转目标列（01 §一.2：columnId 换、index 归零）", () => {
    const { engine, dispose } = makeMenuStory();
    engine.start();
    engine.advance();
    engine.choose("square");
    expect(engine.get(SYS.menuSelected)).toBe(1);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentSceneColumn)).toBe("square");
    expect(engine.get(SYS.currentDialogText)).toBe("广场线");
    dispose();
  });

  it("E6：未知目标 fail-closed，菜单等待保持且可重选", () => {
    const { engine, errors, dispose } = makeMenuStory();
    engine.start();
    engine.advance();
    engine.choose("nope");
    expect(errorPayload(errors[0]).code).toBe("choice-unknown-target");
    expect(engine.get(SYS.waiting)).toBe("menu");
    engine.choose("inn");
    expect(engine.get(SYS.menuSelected)).toBe(0);
    expect(engine.get(SYS.currentSceneColumn)).toBe("inn");
    dispose();
  });

  it("U8/E5：菜单等待中 advance 无效", () => {
    const { engine, errors, dispose } = makeMenuStory();
    engine.start();
    engine.advance();
    engine.advance();
    expect(errorPayload(errors[0]).code).toBe("advance-invalid");
    dispose();
  });

  it("未启动 choose 无效", () => {
    const { engine, errors, dispose } = makeMenuStory();
    engine.choose("inn");
    expect(errorPayload(errors[0]).code).toBe("choose-invalid");
    dispose();
  });
});

describe("notify（01 §二.1 → 08 §二.4）", () => {
  it("出站 notify 事件且不阻塞推进", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "notify", text: "存档成功", type: "info", duration: 2000 },
      { op: "say", text: "s" },
    ]);
    engine.start();
    expect(errors[0]?.payload).toMatchObject({
      kind: "notify",
      text: "存档成功",
      notifyType: "info",
      duration: 2000,
    });
    expect(engine.get(SYS.waiting)).toBe("dialog");
    dispose();
  });
});

describe("say 文本插值（01 §三.4/§三.6，F7/S8）", () => {
  it("{expr:format} 补零 + {expr} 求值", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "gold", value: 7 },
      { op: "say", text: "金币 {gold:000}，翻倍 {gold * 2}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("金币 007，翻倍 14");
    dispose();
  });

  it("行内标记 {b}{/b}{p} 原样透传（01 §三.6）；单字母标记与变量冲突时已定义变量优先", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "i", value: 3 },
      { op: "say", text: "{b}粗{/b}{p}尾 {i}" },
    ]);
    engine.start();
    // {b}{/b}{p} 是标记（b/p 未定义为变量）→ 透传；{i} 已定义 → 插值
    expect(engine.get(SYS.currentDialogText)).toBe("{b}粗{/b}{p}尾 3");
    dispose();

    const h2 = makeEngine([{ op: "say", text: "{i}斜体" }]);
    h2.engine.start();
    expect(h2.engine.get(SYS.currentDialogText)).toBe("{i}斜体");
    h2.dispose();
  });

  it("S8：插值失败保留原文 + engine.error", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "say", text: "你好 {missing}！" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("你好 {missing}！");
    expect(hasError(errors, "unknown-variable")).toBe(true);
    dispose();
  });

  it("F7：格式占位只在文本命令生效——set 值中的 ':00' 是表达式语法错误", () => {
    const { engine, changes, errors, dispose } = makeEngine([
      { op: "set", key: "gold", value: "{7:00}" },
      { op: "say", text: "s" },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("parse-error");
    expect(changes.filter((c) => c.key === "gold")).toHaveLength(0);
    dispose();
  });
});

describe("wait/pause（01 §二.1：wait 可 skipable、pause=hard；02 §二.2 定时解除）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("wait 到时自动继续", () => {
    vi.useFakeTimers();
    const { engine, dispose } = makeEngine([
      { op: "wait", seconds: 0.05 },
      { op: "say", text: "after" },
    ]);
    engine.start();
    expect(engine.get(SYS.waiting)).toBe("wait");
    expect(engine.get(SYS.currentDialogText)).toBeUndefined();
    vi.advanceTimersByTime(60);
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("after");
    dispose();
  });

  it("wait skipable=true 可点击提前解除（02 §二.2：超时或用户点击）", () => {
    vi.useFakeTimers();
    const { engine, dispose } = makeEngine([
      { op: "wait", seconds: 60, skipable: true },
      { op: "say", text: "after" },
    ]);
    engine.start();
    engine.advance(); // 点击跳过
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("after");
    vi.advanceTimersByTime(61_000); // 定时器已取消，不重复触发
    expect(engine.get(SYS.waiting)).toBe("dialog");
    dispose();
  });

  it("wait 默认不可跳过：advance 报错，到时才继续", () => {
    vi.useFakeTimers();
    const { engine, errors, dispose } = makeEngine([
      { op: "wait", seconds: 60 },
      { op: "say", text: "after" },
    ]);
    engine.start();
    engine.advance();
    expect(errorPayload(errors[0]).code).toBe("advance-invalid");
    expect(engine.get(SYS.waiting)).toBe("wait");
    vi.advanceTimersByTime(60_000);
    expect(engine.get(SYS.currentDialogText)).toBe("after");
    dispose();
  });

  it("pause 永不可跳过（01 §二.1：pause=hard）", () => {
    vi.useFakeTimers();
    const { engine, errors, dispose } = makeEngine([
      { op: "pause", seconds: 60 },
      { op: "say", text: "after" },
    ]);
    engine.start();
    engine.advance();
    expect(errorPayload(errors[0]).code).toBe("advance-invalid");
    vi.advanceTimersByTime(60_000);
    expect(engine.get(SYS.currentDialogText)).toBe("after");
    dispose();
  });

  it("dispose 取消挂起定时器，之后不再恢复执行", () => {
    vi.useFakeTimers();
    const { engine, dispose } = makeEngine([
      { op: "wait", seconds: 60 },
      { op: "say", text: "after" },
    ]);
    engine.start();
    engine.dispose();
    vi.advanceTimersByTime(120_000);
    expect(engine.get(SYS.waiting)).toBe("wait");
    expect(engine.get(SYS.currentDialogText)).toBeUndefined();
    dispose();
  });
});

describe("while/break/continue（04 §二.1 执行期求值；老规范 §6.1）", () => {
  it("while 循环累加至条件退出", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "i", value: 0 },
      {
        op: "while",
        cond: "{i < 3}",
        body: [{ op: "set", key: "i", value: "+= {1}" }],
      },
      { op: "say", text: "{i}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("3");
    dispose();
  });

  it("loop-limit 防死循环：超上限 fail-closed 停机", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "set", key: "n", value: 0 },
      {
        op: "while",
        cond: "{true}",
        body: [{ op: "set", key: "n", value: "+= {1}" }],
      },
      { op: "say", text: "never" },
    ]);
    engine.start();
    expect(errorPayload(errors.at(-1)).code).toBe("loop-limit");
    expect(engine.get(SYS.waiting)).toBeUndefined(); // 循环不进等待态，报错即停
    dispose();
  });

  it("break 立即退出循环（嵌套 if 内也可用）", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "i", value: 0 },
      {
        op: "while",
        cond: "{true}",
        body: [
          { op: "set", key: "i", value: "+= {1}" },
          { op: "if", cond: "{i >= 2}", then: [{ op: "break" }] },
        ],
      },
      { op: "say", text: "{i}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("2");
    dispose();
  });

  it("continue 跳过本轮剩余命令", () => {
    const { engine, dispose } = makeEngine([
      { op: "set", key: "i", value: 0 },
      { op: "set", key: "sum", value: 0 },
      {
        op: "while",
        cond: "{i < 5}",
        body: [
          { op: "set", key: "i", value: "+= {1}" },
          { op: "if", cond: "{i == 2}", then: [{ op: "continue" }] },
          { op: "set", key: "sum", value: "+= {1}" },
        ],
      },
      { op: "say", text: "{sum}" },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("4");
    dispose();
  });

  it("循环体声明每轮块级：出循环不可见（S1）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        op: "while",
        cond: "{false}",
        body: [{ op: "let", key: "tmp", value: 1 }],
      },
      { op: "say", text: "{tmp}" },
    ]);
    engine.start();
    expect(hasError(errors, "unknown-variable")).toBe(true);
    dispose();
  });

  it("break/continue 在循环外 → engine.error", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "break" },
      { op: "say", text: "s" },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("break-outside-loop");
    dispose();

    const h2 = makeEngine([{ op: "continue" }, { op: "say", text: "s" }]);
    h2.engine.start();
    expect(errorPayload(h2.errors[0]).code).toBe("continue-outside-loop");
    h2.dispose();
  });
});

describe("for/foreach（老规范 §6.1：数组迭代，foreach 编译为 for 同构）", () => {
  it("for 遍历表达式数组，循环变量逐元素绑定", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "array", key: "deck", items: ["甲", "乙"] },
      {
        op: "for",
        var: "card",
        in: "{deck}",
        body: [{ op: "say", text: "抽到：{card}" }],
      },
    ]);
    engine.start();
    engine.advance(); // 第一句说完 → 第二轮
    const says = changes.filter((c) => c.key === SYS.currentDialogText);
    expect(says.map((c) => c.value)).toEqual(["抽到：甲", "抽到：乙"]);
    dispose();
  });

  it("foreach 按集合变量名遍历；出循环变量不可见（S1）", () => {
    const { engine, changes, errors, dispose } = makeEngine([
      { op: "array", key: "bag", items: [1, 2] },
      {
        op: "foreach",
        var: "item",
        key: "bag",
        body: [{ op: "say", text: "{item}" }],
      },
      { op: "say", text: "{item}" },
    ]);
    engine.start();
    engine.advance(); // 1 → 2
    engine.advance(); // 2 → 出循环
    const says = changes.filter((c) => c.key === SYS.currentDialogText);
    expect(says.map((c) => c.value)).toEqual(["1", "2", "{item}"]); // 出循环 {item} 未定义（S1+S8 保留原文）
    expect(hasError(errors, "unknown-variable")).toBe(true);
    dispose();
  });

  it("for 的 in 表达式非数组 → type-error；空数组直接跳过", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "for", var: "x", in: "{5}", body: [{ op: "say", text: "x" }] },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("type-error");
    dispose();

    const h2 = makeEngine([
      { op: "array", key: "empty", items: [] },
      { op: "for", var: "x", in: "{empty}", body: [{ op: "say", text: "x" }] },
      { op: "say", text: "done" },
    ]);
    h2.engine.start();
    expect(h2.engine.get(SYS.currentDialogText)).toBe("done");
    h2.dispose();
  });
});

describe("switch（老规范 §6.1：case 字面量相等比较，不穿透）", () => {
  const makeSwitch = (cases: object[], extra: object[] = []): Harness =>
    makeEngine([
      {
        op: "switch",
        on: "{1 + 1}",
        cases,
        default: [{ op: "say", text: "default" }],
      },
      ...extra,
    ]);

  it("命中 case 执行其 body，之后跳出整个 switch（不穿透）", () => {
    const { engine, changes, dispose } = makeSwitch(
      [
        { value: 1, body: [{ op: "say", text: "one" }] },
        { value: 2, body: [{ op: "say", text: "two" }] },
      ],
      [{ op: "say", text: "after" }],
    );
    engine.start();
    engine.advance(); // case body 的 say 完成后回到主列
    const says = changes.filter((c) => c.key === SYS.currentDialogText);
    expect(says.map((c) => c.value)).toEqual(["two", "after"]);
    dispose();
  });

  it("无命中走 default", () => {
    const { engine, dispose } = makeSwitch([
      { value: 9, body: [{ op: "say", text: "nine" }] },
    ]);
    engine.start();
    expect(engine.get(SYS.currentDialogText)).toBe("default");
    dispose();
  });

  it("跨类型比较 → type-error 停机（S5）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        op: "switch",
        on: "{1}",
        cases: [{ value: "a", body: [{ op: "say", text: "s" }] }],
      },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("type-error");
    dispose();
  });
});

describe("array/dict（老规范 §6.2）", () => {
  it("array 创建 + push + pop（写入新数组引用，观察者可感知）", () => {
    const { engine, changes, dispose } = makeEngine([
      { op: "array", key: "list", items: [1, 2] },
      { op: "array_push", key: "list", value: "{10 * 3}" },
      { op: "array_pop", key: "list" },
    ]);
    engine.start();
    expect(engine.get("list")).toEqual([1, 2]); // push 30 后 pop 回到 [1, 2]
    const listWrites = changes.filter((c) => c.key === "list");
    expect(listWrites).toHaveLength(3); // array/push/pop 各镜像一次
    dispose();
  });

  it("array_push 目标非数组、array_pop 空数组 → fail-closed", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "array_push", key: "nope", value: 1 },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("type-error");
    dispose();

    const h2 = makeEngine([
      { op: "array", key: "e", items: [] },
      { op: "array_pop", key: "e" },
    ]);
    h2.engine.start();
    expect(errorPayload(h2.errors[0]).code).toBe("type-error");
    h2.dispose();
  });

  it("dict 创建（字段 {expr} 求值）+ dict_set + 点路径插值", () => {
    const { engine, dispose } = makeEngine([
      { op: "dict", key: "cfg", value: { hp: "{20 + 2}", name: "设置" } },
      { op: "dict_set", key: "cfg", field: "mp", value: 5 },
      { op: "say", text: "{cfg.hp}/{cfg.mp}" },
    ]);
    engine.start();
    expect(engine.get("cfg")).toEqual({ hp: 22, name: "设置", mp: 5 });
    expect(engine.get(SYS.currentDialogText)).toBe("22/5");
    dispose();
  });

  it("array/dict 的 once：已存在跳过", () => {
    const { engine, dispose } = makeEngine(
      [
        { op: "array", key: "a", items: [1], once: true },
        { op: "dict", key: "d", value: { x: 1 }, once: true },
      ],
      { a: [9], d: { x: 9 } },
    );
    engine.start();
    expect(engine.get("a")).toEqual([9]);
    expect(engine.get("d")).toEqual({ x: 9 });
    dispose();
  });
});

describe("func/call/return（04 §一.7，老规范 §6.1/6.2）", () => {
  it("func 注册 → call 调用：参数按位绑定进函数体独立块", () => {
    const { engine, changes, dispose } = makeEngine(
      [
        {
          op: "func",
          name: "greet",
          params: ["who"],
          body: [{ op: "say", speaker: "{who}", text: "你好，{who}！" }],
        },
        { op: "call", target: "greet", args: ["{player.name}"] },
      ],
      { "player.name": "旅人" },
    );
    engine.start();
    // 函数体执行：speaker 与 text 均经插值绑定实参
    expect(
      changes.filter((c) => c.key === SYS.currentDialogSpeaker).at(-1)?.value,
    ).toBe("旅人");
    expect(engine.get(SYS.currentDialogText)).toBe("你好，旅人！");
    dispose();
  });

  it("call 后回到调用方继续执行（return 显式弹出，后续命令不可达）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        op: "func",
        name: "fx",
        params: [],
        body: [
          { op: "notify", text: "函数内" },
          { op: "return" },
          { op: "notify", text: "不可达" },
        ],
      },
      { op: "call", target: "fx" },
      { op: "notify", text: "回到调用方" },
      { op: "say", text: "end" },
    ]);
    engine.start();
    expect(errors[0]?.payload).toMatchObject({
      kind: "notify",
      text: "函数内",
    });
    expect(errors[1]?.payload).toMatchObject({
      kind: "notify",
      text: "回到调用方",
    });
    expect(errors).toHaveLength(2); // return 之后的 notify 不可达
    dispose();
  });

  it("函数体出栈后参数不可见（独立块，S1）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        op: "func",
        name: "fx",
        params: ["pp"],
        body: [{ op: "say", text: "{pp}" }],
      },
      { op: "call", target: "fx", args: [7] },
      { op: "say", text: "{pp}" },
    ]);
    engine.start(); // 停在函数体第一句：text = '7'
    engine.advance(); // 函数体出栈 → 回到主列
    expect(engine.get(SYS.currentDialogText)).toBe("{pp}"); // S8 保留原文（pp 未定义且非行内标记）
    expect(hasError(errors, "unknown-variable")).toBe(true);
    dispose();
  });

  it("未注册函数 / 参数个数不符 → fail-closed", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "call", target: "nope" },
      { op: "say", text: "s" },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("call-unknown-function");
    dispose();

    const h2 = makeEngine([
      { op: "func", name: "fx", params: ["a", "b"], body: [] },
      { op: "call", target: "fx", args: [1] },
      { op: "say", text: "s" },
    ]);
    h2.engine.start();
    expect(errorPayload(h2.errors[0]).code).toBe("arity-error");
    h2.dispose();
  });

  it("重复注册 / 函数外 return → fail-closed；break 不跨函数边界", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "func", name: "fx", params: [], body: [] },
      { op: "func", name: "fx", params: [], body: [] },
      { op: "say", text: "s" },
    ]);
    engine.start();
    expect(errorPayload(errors[0]).code).toBe("func-duplicate");
    dispose();

    const h2 = makeEngine([{ op: "return" }, { op: "say", text: "s" }]);
    h2.engine.start();
    expect(errorPayload(h2.errors[0]).code).toBe("return-outside-func");
    h2.dispose();

    const h3 = makeEngine([
      { op: "func", name: "fx", params: [], body: [{ op: "break" }] },
      { op: "call", target: "fx" },
      { op: "say", text: "s" },
    ]);
    h3.engine.start();
    expect(errorPayload(h3.errors[0]).code).toBe("break-outside-loop");
    h3.dispose();
  });
});

describe("input（老规范 §6.1：prompt + store；02 §三.2 命令面 input(text)）", () => {
  it("进入输入等待：写 prompt + 清对话残留；提交写入 store 并继续", () => {
    const { engine, dispose } = makeEngine([
      { op: "input", prompt: "你的名字：", store: "player.name" },
      { op: "say", text: "你好，{player.name}" },
    ]);
    engine.start();
    expect(engine.get(SYS.waiting)).toBe("input");
    expect(engine.get(SYS.inputPrompt)).toBe("你的名字：");
    expect(engine.get(SYS.currentDialogText)).toBe("");
    engine.input("旅人");
    expect(engine.get("player.name")).toBe("旅人");
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("你好，旅人");
    dispose();
  });

  it("非输入等待态 input → fail-closed", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "s" }]);
    engine.start();
    engine.input("x");
    expect(errorPayload(errors[0]).code).toBe("input-invalid");
    dispose();
  });
});

describe("03 回溯与历史（R1–R6 锚点）", () => {
  /** 多列故事：say1 → say2 → menu(inn/square)，两目标列各一句 say */
  function makeMulti(): Harness {
    const story = parseStory({
      formatVersion: 1,
      id: "r",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "第一句" },
            { op: "say", text: "第二句" },
            {
              op: "menu",
              prompt: "去哪",
              options: [
                { text: "酒馆", target: "inn" },
                { text: "广场", target: "square" },
              ],
            },
          ],
        },
        { id: "inn", kind: "flow", commands: [{ op: "say", text: "酒馆线" }] },
        {
          id: "square",
          kind: "flow",
          commands: [{ op: "say", text: "广场线" }],
        },
      ],
    });
    return instrument(new StoryEngine(story, { rngSeed: 42 }));
  }

  it("R1：say 检查点在等待解除后提交，快照捕获玩家所见（锚点: checkpoint-after-click-captures-visible-state）", () => {
    const { engine, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    expect(engine.historyView()).toHaveLength(0); // 上屏未点击：不入档
    engine.advance(); // 解除 say 甲
    const view = engine.historyView();
    expect(view).toHaveLength(1);
    expect(view[0]?.text).toBe("甲"); // 快照 = 玩家刚看到的画面
    expect(view[0]?.coord).toEqual({ columnId: "start", index: 0 });
    dispose();
  });

  it("R3+R4：回溯到菜单检查点真实等待；重放期输入锁；完成发 rollback.done（锚点: replay-stops-at-menu / rollback-replay-input-lock）", () => {
    const { engine, changes, errors, dispose } = makeMulti();
    engine.start();
    engine.advance(); // say1 解除 → 检查点 0
    engine.advance(); // say2 解除 → 检查点 1
    engine.advance(); // menu 展示 → 检查点 2
    expect(engine.get(SYS.waiting)).toBe("menu");
    engine.choose("inn"); // 选择 → live 未入档
    expect(engine.get(SYS.waiting)).toBe("dialog"); // 酒馆线首句

    const doneCount = errors.filter(
      (e) => e.payload.kind === "rollback.done",
    ).length;
    engine.rollbackTo(2); // 回到菜单
    expect(
      errors.filter((e) => e.payload.kind === "rollback.done"),
    ).toHaveLength(doneCount + 1);
    expect(engine.get(SYS.waiting)).toBe("menu"); // R3：重放停在菜单真实等待
    expect(engine.get(SYS.rollbackActive)).toBe(false); // R4：重放完成输入锁解除
    expect(engine.get(SYS.currentDialogText)).toBe(""); // menu 清对话残留
    expect(changes.length).toBeGreaterThan(0);
    // 回放后可正常交互（advance 在 menu 等待中无效属 E5 语义，用 choose 验证）
    engine.choose("square");
    expect(engine.get(SYS.waiting)).toBe("dialog");
    dispose();
  });

  it("R4：回溯重放后陈旧完成标记已清（锚点: stale-complete-during-replay）", () => {
    const { engine, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    engine.advance(); // 甲解除 → 检查点 0（快照 complete=false）
    engine.advance(); // 乙上屏（complete=true 残留态）
    engine.rollbackTo(0); // 回放到甲
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
    expect(engine.get(SYS.dialogComplete)).toBe(false); // 重放重写对话键时已清陈旧标记
    dispose();
  });

  it("R2：重选 ≠ 旧选择 → 截断旧前向时间线（锚点: menu-reselect-opens-new-timeline）", () => {
    const { engine, errors, dispose } = makeMulti();
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance(); // menu
    engine.choose("inn");
    engine.advance(); // 酒馆线上屏 → 检查点 3
    expect(engine.historyView()).toHaveLength(4);
    engine.rollbackTo(2); // 回菜单
    engine.choose("square"); // 换一条线
    engine.advance(); // 广场线上屏 → 提交时分岔
    const view = engine.historyView();
    expect(view).toHaveLength(4); // 旧前向（酒馆线检查点）已截断
    expect(view[3]?.coord.columnId).toBe("square");
    engine.forward(); // 旧前向已截断 → 无路可前进
    expect(errorPayload(errors.at(-1)).code).toBe("no-forward");
    dispose();
  });

  it("R2：重选同一选项 → 时间线延续，rollforward 可用", () => {
    const { engine, errors, dispose } = makeMulti();
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance(); // menu
    engine.choose("inn");
    engine.advance(); // 酒馆线上屏
    engine.rollbackTo(2); // 回菜单
    engine.choose("inn"); // 同一选择
    engine.advance(); // 同坐标提交 → 保留前向
    expect(engine.historyView()).toHaveLength(4);
    const before = errors.length;
    engine.forward(); // 已在最新处 → no-forward（而非崩溃）
    expect(errors.length).toBeGreaterThan(before);
    dispose();
  });

  it("R5：live 消歧——选择后回退落回菜单重选；菜单展示中回退落到上一检查点（锚点: live-vs-checkpoint-disambiguation）", () => {
    const { engine, dispose } = makeMulti();
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance(); // menu 展示（live 已入档）
    engine.choose("inn"); // live 未入档
    engine.back(); // 落回菜单重选（不跳过它）
    expect(engine.get(SYS.waiting)).toBe("menu");
    engine.back(); // 菜单展示中再回退 → 上一检查点（say2）
    expect(engine.get(SYS.waiting)).toBe("dialog");
    expect(engine.get(SYS.currentDialogText)).toBe("第二句");
    dispose();
  });

  it("R6：显式种子 random op 确定性——同种子同结果，与初始 rngState 无关", () => {
    const commands = [
      { op: "random", seed: 7, range: [0, 1000], var: "roll" },
      { op: "say", text: "掷出 {roll}" },
    ];
    const make = (seed: number): StoryEngine => {
      const e = new StoryEngine(
        parseStory({
          formatVersion: 1,
          id: "d",
          columns: [{ id: "start", kind: "flow", commands }],
        }),
        { rngSeed: seed },
      );
      e.start();
      return e;
    };
    const e1 = make(1);
    const e2 = make(999);
    expect(e1.get("roll")).toBe(e2.get("roll")); // seed=7 决定结果
    expect(e1.get(SYS.currentDialogText)).toBe(
      `掷出 ${String(e1.get("roll"))}`,
    );
  });

  it("R6：回溯后重放随机序列一致", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "开场" },
            { op: "set", key: "a", value: "{random(0, 99999)}" },
            { op: "say", text: "{a}" },
          ],
        },
      ],
    });
    const e = new StoryEngine(story, { rngSeed: 99 });
    const h = instrument(e);
    e.start();
    e.advance(); // 开场解除 → 检查点 0（快照含 rngState）
    e.advance(); // a 求值上屏 → 检查点 1
    const a1 = e.get("a");
    e.rollbackTo(0); // 回到开场
    e.advance(); // 重放：a 重新求值
    e.advance();
    expect(e.get("a")).toBe(a1); // rngState 随快照恢复 → 序列必然一致
    expect(h.changes.length).toBeGreaterThan(0);
    h.dispose();
  });

  it("§三.3 容量淘汰：超限淘汰最旧（锚点: history-capacity-eviction）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "一" },
            { op: "say", text: "二" },
            { op: "say", text: "三" },
            { op: "say", text: "四" },
          ],
        },
      ],
    });
    const e = new StoryEngine(story, { historyLimit: 2 });
    e.start();
    e.advance();
    e.advance();
    e.advance();
    e.advance();
    const view = e.historyView();
    expect(view).toHaveLength(2);
    expect(view[0]?.text).toBe("三"); // 最旧（一、二）被淘汰
    e.rollbackTo(0);
    expect(e.get(SYS.currentDialogText)).toBe("三");
  });

  it("back/forward 边界：空历史回退、最新处前进 → fail-closed", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "s" }]);
    engine.start();
    engine.back();
    expect(errorPayload(errors[0]).code).toBe("history-empty");
    engine.forward();
    expect(errorPayload(errors.at(-1)).code).toBe("no-forward");
    dispose();
  });

  it("函数注册表随快照恢复：回溯到 func 之前重放可重新注册（不炸 func-duplicate）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "开场" },
            {
              op: "func",
              name: "fx",
              params: [],
              body: [{ op: "notify", text: "函数执行" }],
            },
            { op: "call", target: "fx" },
            { op: "say", text: "结束" },
          ],
        },
      ],
    });
    const e = new StoryEngine(story, { rngSeed: 1 });
    const h = instrument(e);
    e.start();
    e.advance(); // 开场解除 → 检查点 0（此时函数表为空）
    e.advance(); // 函数内 notify → call → 结束上屏（函数已注册）
    e.rollbackTo(0); // 回到开场：函数表应恢复为空
    e.advance(); // 重放：func 重新注册 → call → 结束上屏
    expect(hasError(h.errors, "func-duplicate")).toBe(false);
    expect(
      h.errors.filter((x) => x.payload.kind === "notify").map((x) => x.payload),
    ).toHaveLength(2);
    expect(e.get(SYS.currentDialogText)).toBe("结束");
    h.dispose();
  });

  it("回溯清挂起 wait 定时器：旧定时器不得在新位置提前触发", () => {
    vi.useFakeTimers();
    const { engine, dispose } = makeEngine([
      { op: "say", text: "甲" },
      { op: "wait", seconds: 60 },
      { op: "say", text: "乙" },
    ]);
    engine.start();
    engine.advance(); // 甲解除 → 检查点 0
    engine.advance(); // wait 建立 → 检查点 1 + 定时器
    engine.back(); // 回到甲（旧 wait 定时器仍挂起）
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
    vi.advanceTimersByTime(61_000); // 旧定时器到点：当前在 dialog 等待 → 不得触发
    expect(engine.get(SYS.currentDialogText)).toBe("甲");
    engine.advance(); // 重新进入 wait（新定时器）
    expect(engine.get(SYS.waiting)).toBe("wait");
    vi.advanceTimersByTime(60_000); // 新定时器正常触发
    expect(engine.get(SYS.currentDialogText)).toBe("乙");
    dispose();
  });

  it("回溯到 say 检查点后可继续逐级回退（不卡在同一点——用户实测回归）", () => {
    const { engine, errors, dispose } = makeEngine([
      { op: "say", text: "一" },
      { op: "say", text: "二" },
      { op: "say", text: "三" },
    ]);
    engine.start();
    engine.advance();
    engine.advance();
    engine.advance(); // 三句全部解除 → 检查点 0/1/2，live 停在列尾
    engine.rollbackTo(2); // 回到第三句
    expect(engine.get(SYS.currentDialogText)).toBe("三");
    engine.back(); // 必须落到第二句（旧实现卡在第三句）
    expect(engine.get(SYS.currentDialogText)).toBe("二");
    engine.back();
    expect(engine.get(SYS.currentDialogText)).toBe("一");
    engine.back(); // 已到最早保留点
    expect(errorPayload(errors.at(-1)).code).toBe("history-empty");
    engine.forward(); // rollforward 回第二句
    expect(engine.get(SYS.currentDialogText)).toBe("二");
    dispose();
  });
});

describe("05 存档编排（TS 侧；S3 块列不进档 / R8 历史随档）", () => {
  function roundTripStory(): Harness {
    const story = parseStory({
      formatVersion: 1,
      id: "save-demo",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "set", key: "gold", value: 5 },
            { op: "say", text: "开场" },
            {
              op: "func",
              name: "fx",
              params: [],
              body: [{ op: "notify", text: "函数内" }],
            },
            { op: "call", target: "fx" },
            { op: "say", text: "尾段" },
          ],
        },
      ],
    });
    return instrument(new StoryEngine(story, { rngSeed: 7 }));
  }

  it("导出→序列化→导入：状态/函数表/等待画面恢复", () => {
    const { engine, dispose } = roundTripStory();
    engine.start();
    engine.advance(); // 开场解除 → 检查点 0 → 函数注册/调用 → 尾段上屏（等待点）
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    // 模拟 JSON 序列化链路（Rust 层拿到的就是这段 JSON）
    const restored = JSON.parse(
      JSON.stringify(data),
    ) as import("./contracts").SaveDataV1;
    expect(restored.functions).toHaveLength(1); // fx 已注册
    const e2 = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "save-demo",
        columns: [
          {
            id: "start",
            kind: "flow",
            commands: [
              { op: "set", key: "gold", value: 5 },
              { op: "say", text: "开场" },
              { op: "func", name: "fx", params: [], body: [] },
              { op: "call", target: "fx" },
              { op: "say", text: "尾段" },
            ],
          },
        ],
      }),
      { rngSeed: 7 },
    );
    const h2 = instrument(e2);
    e2.importSave(restored);
    expect(e2.get(SYS.currentDialogText)).toBe("尾段"); // 重放重建等待画面
    expect(e2.get("gold")).toBe(5);
    expect(e2.get(SYS.waiting)).toBe("dialog");
    expect(h2.changes.length).toBeGreaterThan(0); // 重放经 ValueChanged 出站
    h2.dispose();
    dispose();
  });

  it("R8：读档后历史可继续回溯（锚点: history-survives-load）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "一" },
            { op: "say", text: "二" },
            { op: "say", text: "三" },
          ],
        },
      ],
    });
    const e1 = new StoryEngine(story, { rngSeed: 3 });
    e1.start();
    e1.advance();
    e1.advance(); // 三上屏（一/二已入档）
    const data = e1.exportSave();
    expect(data).not.toBeNull();

    const e2 = new StoryEngine(story, { rngSeed: 3 });
    e2.importSave(
      JSON.parse(JSON.stringify(data)) as import("./contracts").SaveDataV1,
    );
    expect(e2.historyView().map((h) => h.text)).toEqual(["一", "二"]); // R8：历史随档
    e2.rollbackTo(0); // 读档后继续回溯
    expect(e2.get(SYS.currentDialogText)).toBe("一");
    e2.forward(); // rollforward
    expect(e2.get(SYS.currentDialogText)).toBe("二");
  });

  it("S3：块/列级作用域不进档——读档后列级 let 不可见（锚点: scope-excluded-from-save）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "let", key: "x", value: 5 },
            { op: "say", text: "x={x}" },
            { op: "say", text: "end" },
            { op: "say", text: "{x}" },
          ],
        },
      ],
    });
    const e1 = new StoryEngine(story);
    e1.start();
    e1.advance(); // let 生效 → say x=5 解除 → 检查点
    e1.advance(); // end 上屏
    const data = e1.exportSave();
    expect(data).not.toBeNull();

    const e2 = new StoryEngine(story);
    const h2 = instrument(e2);
    e2.importSave(
      JSON.parse(JSON.stringify(data)) as import("./contracts").SaveDataV1,
    );
    e2.advance(); // end 解除 → 下一句引用 x → 列级作用域已随 S3 丢弃
    expect(e2.get(SYS.currentDialogText)).toBe("{x}"); // S8 保留原文
    expect(hasError(h2.errors, "unknown-variable")).toBe(true);
  });

  it("版本/故事不匹配 → fail-closed（§四.6）", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "s" }]);
    engine.start(); // say s 上屏（等待点）
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    expect(
      engine.importSave({
        ...(data as import("./contracts").SaveDataV1),
        formatVersion: 2 as never,
      }),
    ).toBe(false); // 拒绝必须以 false 回报，调用方不得误报成功
    expect(errorPayload(errors.at(-1)).code).toBe("save-format");
    expect(
      engine.importSave({
        ...(data as import("./contracts").SaveDataV1),
        storyId: "other-story",
      }),
    ).toBe(false);
    expect(errorPayload(errors.at(-1)).code).toBe("save-story-mismatch");
    // 合法载荷 → true
    expect(engine.importSave(data as import("./contracts").SaveDataV1)).toBe(
      true,
    );
    dispose();
  });

  it("读档后回退再前进：离开时的画面补交入档，forward 可回到离开位置（用户实测回归）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "一" },
            { op: "input", prompt: "名字", store: "player.name" },
            { op: "say", text: "二" },
          ],
        },
      ],
    });
    const e = new StoryEngine(story, { rngSeed: 1 });
    const h = instrument(e);
    e.start();
    e.advance(); // 一解除 → cp0
    e.input("测试"); // input 提交 → cp1（input）→ 二上屏（pending 未入档）
    expect(e.historyView()).toHaveLength(2);
    e.back(); // 离开二：补交二的检查点 → 落回 input 等待
    expect(e.get(SYS.waiting)).toBe("input");
    expect(e.historyView()).toHaveLength(3); // 二已入档
    e.forward(); // forward 回到离开时的画面
    expect(e.get(SYS.currentDialogText)).toBe("二");
    expect(e.get(SYS.waiting)).toBe("dialog");
    h.dispose();
  });

  it("等待点之外存档 → fail-closed 拒绝", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "s" }]);
    engine.start();
    engine.advance();
    engine.advance(); // 列尾：waiting=none
    expect(engine.exportSave()).toBeNull();
    expect(errorPayload(errors.at(-1)).code).toBe("save-invalid");
    dispose();
  });

  it("块内等待点的检查点坐标恒指列内顶层（columnId 非 null，01 §一.4）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "开场" },
            {
              op: "if",
              cond: "{true}",
              then: [{ op: "say", text: "块内" }],
            },
            { op: "say", text: "尾段" },
          ],
        },
      ],
    });
    const e = new StoryEngine(story);
    e.start();
    e.advance(); // 开场解除 → 检查点 0
    e.advance(); // 块内 say 上屏 → 待提交检查点
    const view = e.historyView();
    expect(view).toHaveLength(2); // 开场解除已入档 + 块内 say 解除入档
    e.advance(); // 块内 say 解除 → 提交
    const after = e.historyView();
    expect(after[1]?.coord).toEqual({ columnId: "start", index: 1 }); // 列级坐标（if 命令位），非 null
  });

  it("存档于块内/函数等待点 → 读档重放 func 幂等重注册，画面重建无 func-duplicate（用户实测回归）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "开场" },
            {
              op: "if",
              cond: "{true}",
              then: [
                { op: "func", name: "fx", params: [], body: [] },
                { op: "call", target: "fx" },
                { op: "say", text: "函数内" },
              ],
            },
            { op: "say", text: "尾段" },
          ],
        },
      ],
    });
    const e1 = new StoryEngine(story, { rngSeed: 5 });
    const h1 = instrument(e1);
    e1.start();
    e1.advance(); // 开场解除 → if → func 注册/调用 → 函数内上屏
    e1.advance(); // 函数内解除 → 尾段上屏（存档点：列级坐标）
    const data = e1.exportSave();
    expect(data).not.toBeNull();
    expect(data?.coord).toEqual({ columnId: "start", index: 2 });

    const e2 = new StoryEngine(story, { rngSeed: 5 });
    const h2 = instrument(e2);
    expect(
      e2.importSave(
        JSON.parse(JSON.stringify(data)) as import("./contracts").SaveDataV1,
      ),
    ).toBe(true);
    expect(
      h2.errors.filter((x) => x.payload.kind === "engine.error"),
    ).toHaveLength(0);
    expect(e2.get(SYS.currentDialogText)).toBe("尾段"); // 重放重建存档时刻画面
    expect(e2.get(SYS.waiting)).toBe("dialog");
    e2.rollbackTo(0); // R8：读档后历史可继续回溯（开场检查点）
    expect(e2.get(SYS.currentDialogText)).toBe("开场");
    h1.dispose();
    h2.dispose();
  });

  it("残缺历史自愈：重放重入的 input 站插入时间线而非截断（用户实测回归）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "d",
      columns: [
        {
          id: "start",
          kind: "flow",
          commands: [
            { op: "say", text: "一" },
            { op: "input", prompt: "名字", store: "player.name" },
            { op: "say", text: "二" },
            { op: "say", text: "三" },
          ],
        },
      ],
    });
    const e1 = new StoryEngine(story, { rngSeed: 8 });
    e1.start();
    e1.advance(); // 一解除 → cp0
    e1.input("甲"); // input 提交 → cp1 → 二上屏
    e1.advance(); // 二解除 → cp2 → 三上屏
    const data = e1.exportSave();
    expect(data).not.toBeNull();

    // 模拟用户残缺存档：历史缺 input 站（旧结构产物）
    const gappy = JSON.parse(
      JSON.stringify(data),
    ) as import("./contracts").SaveDataV1;
    gappy.history = gappy.history.filter((h) => h.coord.index !== 1);
    expect(gappy.history).toHaveLength(2); // [一, 二]

    const e2 = new StoryEngine(story, { rngSeed: 8 });
    const h2 = instrument(e2);
    expect(e2.importSave(gappy)).toBe(true); // 坐标有效 → 通过（自愈路径）
    expect(e2.get(SYS.currentDialogText)).toBe("三");
    e2.back(); // → 二
    expect(e2.get(SYS.currentDialogText)).toBe("二");
    e2.back(); // → 一
    expect(e2.get(SYS.currentDialogText)).toBe("一");
    e2.advance(); // 一解除 → 重入 input → 中间站插入（非截断）
    expect(e2.get(SYS.waiting)).toBe("input");
    expect(e2.historyView().map((h) => h.coord.index)).toEqual([0, 1, 2, 3]);
    e2.input("乙"); // 重新输入 → 二
    e2.advance(); // 二解除 → 三（同坐标 cursor 前移，前向保留）
    expect(e2.get(SYS.currentDialogText)).toBe("三");
    expect(e2.historyView().map((h) => h.coord.index)).toEqual([0, 1, 2, 3]);
    h2.dispose();
  });

  it("历史坐标失效 / 结构不完整 → fail-closed 而非崩溃（§四.6，用户实测回归）", () => {
    const { engine, errors, dispose } = makeEngine([{ op: "say", text: "s" }]);
    engine.start();
    const good = engine.exportSave();
    expect(good).not.toBeNull();
    const base = good as import("./contracts").SaveDataV1;

    // 历史检查点引用不存在的列（旧结构存档）→ save-story-mismatch，绝不上抛 TypeError
    expect(
      engine.importSave({
        ...base,
        history: [
          {
            coord: { columnId: "ghost-column", index: 0 },
            state: [],
            rngState: 0,
          },
        ],
      }),
    ).toBe(false);
    expect(errorPayload(errors.at(-1)).code).toBe("save-story-mismatch");

    // 结构不完整（缺 history）→ save-format
    const broken = { ...base } as Record<string, unknown>;
    delete broken.history;
    expect(
      engine.importSave(broken as unknown as import("./contracts").SaveDataV1),
    ).toBe(false);
    expect(errorPayload(errors.at(-1)).code).toBe("save-format");
    dispose();
  });
});

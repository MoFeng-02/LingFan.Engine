/**
 * call into 结果通道测试：ret 带值 / 函数体自然跑完绑 null / 覆盖式声明 /
 * 嵌套与递归 / 回溯-前进-存读档三态一致 / 混沌随机游走不变量。
 *
 * 确定性红线：同种子同序列重放结果一致；回溯到 call 前后，into 绑定的结果一致
 * （result 槽与 into 名随帧快照保存，存档/读档不丢）。
 */
import { describe, expect, it } from "vitest";
import type { OutboundEvent, SaveDataV1 } from "@lingfan/engine";
import { SYS, StoryEngine, parseStory } from "@lingfan/engine";

const VALID_WAITING = [
  undefined,
  "none",
  "dialog",
  "menu",
  "wait",
  "input",
  "minigame",
  "video",
];

function makeEngine(
  columns: object[],
  defines?: Record<string, unknown>,
): { engine: StoryEngine; errors: OutboundEvent[]; dispose: () => void } {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "into",
      ...(defines === undefined ? {} : { defines }),
      columns,
    }),
    { rngSeed: 9 },
  );
  const errors: OutboundEvent[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e);
  });
  return {
    engine,
    errors,
    dispose: () => {
      off();
    },
  };
}

function errorOf(errors: OutboundEvent[], index: number): { code: string } {
  const e = errors[index];
  if (e === undefined || e.payload.kind !== "engine.error") {
    throw new Error(`期望 engine.error：${JSON.stringify(errors)}`);
  }
  return { code: e.payload.code };
}

function dialog(engine: StoryEngine): string {
  return engine.get(SYS.currentDialogText) as string;
}

describe("call into：返回值绑定（拟态旅程）", () => {
  it("ret 带值 → into 绑定为调用方局部变量；进入全局状态（写时复制边界外）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "double",
            params: ["v"],
            body: [{ op: "return", value: "{v * 2}" }],
          },
          { op: "call", target: "double", args: [3], into: "x" },
          { op: "say", text: "结果：{x}" },
        ],
      },
    ]);
    engine.start();
    expect(dialog(engine)).toBe("结果：6");
    expect(errors).toHaveLength(0);
    // into 是调用方**作用域**的局部变量，不落全局状态键
    expect(engine.get("x")).toBeUndefined();
    dispose();
  });

  it("裸 ret 与函数体自然跑完：into 绑定 null（与表达式内建缺失语义同族）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "bare",
            params: [],
            body: [{ op: "return" }],
          },
          {
            op: "func",
            name: "voidy",
            params: [],
            body: [{ op: "notify", text: "跑完" }],
          },
          { op: "call", target: "bare", into: "a" },
          { op: "call", target: "voidy", into: "b" },
          { op: "say", text: '{a ?? "缺"}|{b ?? "缺"}' },
        ],
      },
    ]);
    engine.start();
    expect(dialog(engine)).toBe("缺|缺");
    expect(errors).toHaveLength(0);
    dispose();
  });

  it("into 覆盖既有同名局部（declare 语义），无 into 的调用静默丢弃返回值", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "five",
            params: [],
            body: [{ op: "return", value: 5 }],
          },
          { op: "let", key: "x", value: 1 },
          { op: "call", target: "five", into: "x" },
          { op: "call", target: "five" },
          { op: "say", text: "{x}" },
        ],
      },
    ]);
    engine.start();
    expect(dialog(engine)).toBe("5");
    expect(errors).toHaveLength(0);
    dispose();
  });

  it("嵌套调用：内层 into 结果经中间局部传出（两层帧各自结算）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "outer",
            params: [],
            body: [
              { op: "call", target: "inner", args: [2], into: "t" },
              { op: "return", value: "{t + 1}" },
            ],
          },
          {
            op: "func",
            name: "inner",
            params: ["a"],
            body: [{ op: "return", value: "{a * 10}" }],
          },
          { op: "call", target: "outer", into: "x" },
          { op: "say", text: "{x}" },
        ],
      },
    ]);
    engine.start();
    expect(dialog(engine)).toBe("21");
    expect(errors).toHaveLength(0);
    dispose();
  });

  it("递归：fact(3) = 6（call into 跨递归帧逐层绑定）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "fact",
            params: ["n"],
            body: [
              {
                op: "if",
                cond: "{n <= 1}",
                then: [{ op: "return", value: 1 }],
              },
              { op: "call", target: "fact", args: ["{n - 1}"], into: "r" },
              { op: "return", value: "{n * r}" },
            ],
          },
          { op: "call", target: "fact", args: [3], into: "x" },
          { op: "say", text: "3!={x}" },
        ],
      },
    ]);
    engine.start();
    expect(dialog(engine)).toBe("3!=6");
    expect(errors).toHaveLength(0);
    dispose();
  });

  it("label 子程序：call 目标列自然结束绑 null，带值 return 也能取到", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          { op: "call", target: "sub_no", into: "a" },
          { op: "call", target: "sub_yes", into: "b" },
          { op: "say", text: '{a ?? "缺"}|{b}' },
        ],
      },
      {
        id: "sub_no",
        kind: "flow",
        commands: [{ op: "notify", text: "子程" }],
      },
      {
        id: "sub_yes",
        kind: "flow",
        commands: [{ op: "return", value: "好的" }],
      },
    ]);
    engine.start();
    expect(dialog(engine)).toBe("缺|好的");
    expect(errors).toHaveLength(0);
    dispose();
  });
});

describe("call into：确定性红线（回溯 / 前进 / 存读档三态一致）", () => {
  function story(): object[] {
    return [
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "double",
            params: ["a"],
            body: [
              { op: "say", text: "内部：{a}" },
              { op: "return", value: "{a * 2}" },
            ],
          },
          { op: "call", target: "double", args: [2], into: "x" },
          { op: "say", text: "结果：{x}" },
        ],
      },
    ];
  }

  it("回溯进函数体内等待点 → 重放 → 结果一致；前进同样一致", () => {
    const { engine, errors, dispose } = makeEngine(story());
    engine.start(); // 停在函数体内 say：内部：2（检查点坐标 = 调用命令）
    expect(dialog(engine)).toBe("内部：2");
    engine.advance(); // ret 带值回写 → 结果：4
    expect(dialog(engine)).toBe("结果：4");
    engine.back(); // 回到函数体内
    expect(dialog(engine)).toBe("内部：2");
    engine.advance(); // 重放同一结算
    expect(dialog(engine)).toBe("结果：4");
    engine.back();
    engine.forward(); // 前向历史重放
    expect(dialog(engine)).toBe("结果：4");
    expect(errors).toHaveLength(0);
    dispose();
  });

  it("存读档：函数体内等待点存档 → 读档续跑 → 结果一致（帧与 into 随档保存）", () => {
    const first = makeEngine(story());
    first.engine.start(); // 停在「内部：2」
    const data = first.engine.exportSave()!;
    first.dispose();
    expect(data).not.toBeNull();

    const second = makeEngine(story());
    expect(
      second.engine.importSave(JSON.parse(JSON.stringify(data)) as SaveDataV1),
    ).toBe(true);
    expect(dialog(second.engine)).toBe("内部：2");
    second.engine.advance();
    expect(dialog(second.engine)).toBe("结果：4");
    second.dispose();
  });

  it("混沌随机游走（种子化 300 步）：公开方法零抛异常 + 等待态合法 + 对话白名单", () => {
    // 进度走全局状态 game.x（set/let 绑定在列帧作用域，导航清帧后不可达；
    // into 绑定的局部量只在调用方列帧存活期内可读），上限 48 保证白名单可枚举
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "double",
            params: ["v"],
            body: [
              { op: "say", text: "双 {v}" },
              { op: "return", value: "{min(v * 2, 48)}" },
            ],
          },
          {
            op: "func",
            name: "voidy",
            params: [],
            body: [{ op: "notify", text: "无返回" }],
          },
          { op: "call", target: "double", args: [3], into: "x" },
          { op: "set", key: "game.x", value: "{x}" },
          { op: "jump", target: "round" },
        ],
      },
      {
        id: "round",
        kind: "flow",
        commands: [
          { op: "say", text: "x={game.x}" },
          { op: "call", target: "voidy" }, // 无 into：返回值静默丢弃
          {
            op: "menu",
            prompt: "选",
            options: [
              { text: "再来", target: "loop" },
              { text: "结束", target: "end" },
            ],
          },
        ],
      },
      {
        id: "loop",
        kind: "flow",
        commands: [
          { op: "call", target: "double", args: ["{game.x}"], into: "r" },
          { op: "set", key: "game.x", value: "{r}" },
          { op: "jump", target: "round" },
        ],
      },
      {
        id: "end",
        kind: "flow",
        commands: [{ op: "say", text: "终 {game.x}" }],
      },
    ]);
    engine.start();
    const LEGAL = new Set([
      "双 3",
      "双 6",
      "双 12",
      "双 24",
      "双 48",
      "x=6",
      "x=12",
      "x=24",
      "x=48",
      "终 6",
      "终 12",
      "终 24",
      "终 48",
      // "" 是合法态：菜单建立等待时清对话镜像（execMenu 清屏语义），
      // 回溯/前进经过清屏点后镜像同样为空串
      "",
    ]);
    let seed = 20261012;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const ops: Array<() => void> = [
      () => engine.advance(),
      () => engine.back(),
      () => engine.forward(),
      () => engine.choose("loop"),
      () => engine.choose("end"),
      () => engine.exportSave(),
    ];
    for (let step = 0; step < 300; step += 1) {
      const op = ops[Math.floor(rnd() * ops.length)]!;
      try {
        if (op === ops[5]) {
          // 存档面：仅等待点可存（waiting=none 时存档被拒）；菜单/dialog 随走随存
          if (engine.get(SYS.waiting) !== "none") engine.exportSave();
        } else if (op === ops[4] || op === ops[3]) {
          // 菜单选择仅在菜单等待态有效；其余时刻必须被拒绝而非异常
          if (engine.get(SYS.waiting) === "menu") op();
        } else {
          op();
        }
      } catch (e) {
        throw new Error(`第 ${step} 步抛出异常：${String(e)}`);
      }
      expect(VALID_WAITING).toContain(engine.get(SYS.waiting));
      const text = dialog(engine);
      expect(
        LEGAL.has(text),
        `第 ${step} 步对话越界：${JSON.stringify(text)}`,
      ).toBe(true);
      for (const entry of engine.historyView()) {
        expect(typeof entry.coord.columnId).toBe("string");
        expect(typeof entry.coord.index).toBe("number");
      }
    }
    // 混沌步中混合操作被守卫拒绝是 fail-closed 正常路径（与 journey 混沌游走同口径）：
    // 不要求零错误，但错误必须全部落在已知拒绝码白名单内——
    // 出现 unknown-variable / type-error 等执行期错误即故事本身有缺陷
    const GUARD_CODES = new Set([
      "advance-invalid",
      "no-forward",
      "history-empty",
    ]);
    for (const e of errors) {
      expect(e.payload.kind).toBe("engine.error");
      if (e.payload.kind !== "engine.error") continue; // 收窄仅供下方读 code/message
      expect(
        GUARD_CODES.has(e.payload.code),
        `越界错误码：${e.payload.code} ${e.payload.message}`,
      ).toBe(true);
    }
    dispose();
  });
});

describe("call into：故意错误 fail-closed", () => {
  it("return 带值表达式求值失败：停机在 return 上，into 不绑定（状态原样）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [
          {
            op: "func",
            name: "bad",
            params: [],
            body: [{ op: "return", value: "{ghost}" }],
          },
          { op: "call", target: "bad", into: "x" },
          { op: "say", text: "{x}" },
        ],
      },
    ]);
    engine.start();
    expect(errorOf(errors, 0).code).toBe("unknown-variable");
    expect(engine.get(SYS.currentDialogText)).toBeUndefined(); // 未到达任何 say，对话镜像未建立
    dispose();
  });

  it("call into 未知目标：call-unknown-target（into 不影响既有守卫）", () => {
    const { engine, errors, dispose } = makeEngine([
      {
        id: "start",
        kind: "flow",
        commands: [{ op: "call", target: "missing", into: "x" }],
      },
    ]);
    engine.start();
    expect(errorOf(errors, 0).code).toBe("call-unknown-target");
    dispose();
  });

  it("数据校验：into 非空字符串（数字/空串 fail-closed 在解析层）", () => {
    const wrap = (cmd: object): object[] => [
      {
        id: "start",
        kind: "flow",
        commands: [{ op: "func", name: "f", params: [], body: [] }, cmd],
      },
    ];
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "v",
        columns: wrap({ op: "call", target: "f", into: 42 }),
      }),
    ).toThrow();
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "v",
        columns: wrap({ op: "call", target: "f", into: "" }),
      }),
    ).toThrow();
  });
});

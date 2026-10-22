/**
 * 路径型内建与 `??` 空值合并测试（引擎表达式文法）。
 *
 * arrayGet/dictGet/optGet/len 经注入的 resolve 读路径数据：路径缺失一律返回 null
 * （配合 ?? 兜底），路径存在但形态不符仍 fail-closed。`??` 优先级同 JS：低于 ||
 * 与 &&、高于三元，左结合短路；与 JS 的差异是 JS 禁止 ?? 与 ||/&& 无括号混用，
 * 引擎按优先级直接分组。裸缺失路径不因 ?? 放宽——
 * 仍按 unknown-variable 拒绝，缺失兜底必须显式经内建。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateExpression,
  ExpressionError,
  interpolateText,
  type NameResolver,
} from "@lingfan-engine/core";

const vars = new Map<string, unknown>([
  ["gold", 7],
  ["player.hp", 30],
  ["flag", false],
  ["bag", ["剑", "盾"]],
  ["empty", [] as unknown[]],
  ["cfg", { speed: 5, label: "快" }],
  ["deep", { a: {} }],
]);

/** 引擎侧名称解析语义的最小模拟：扁平优先 → 点路径字典下钻（同 expr.test.ts） */
const resolve: NameResolver = (name) => {
  if (vars.has(name)) return { found: true, value: vars.get(name) };
  const parts = name.split(".");
  let cur: unknown = vars.has(parts[0]!) ? vars.get(parts[0]!) : undefined;
  if (cur === undefined) return { found: false };
  for (const seg of parts.slice(1)) {
    if (cur === null || typeof cur !== "object") return { found: false };
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur === undefined ? { found: false } : { found: true, value: cur };
};

const evalExpr = (src: string): unknown => evaluateExpression(src, resolve);

const failCode = (src: string): string => {
  try {
    evalExpr(src);
  } catch (e) {
    if (e instanceof ExpressionError) return e.code;
    throw e;
  }
  throw new Error(`应当抛出 ExpressionError：${src}`);
};

describe("?? 空值合并", () => {
  it("左支有值取左支，缺失经内建兜底", () => {
    expect(evalExpr("cfg.speed ?? 9")).toBe(5);
    expect(evalExpr('optGet("cfg.ghost") ?? 9')).toBe(9);
    expect(evalExpr('optGet("deep.a.b.c") ?? "无"')).toBe("无");
  });
  it("短路：左支非空时右支不求值（resolver 只被左支调用一次）", () => {
    let calls = 0;
    const spy: NameResolver = (name) => {
      calls += 1;
      return resolve(name);
    };
    expect(
      evaluateExpression('optGet("cfg.speed") ?? optGet("nope")', spy),
    ).toBe(5);
    expect(calls).toBe(1);
  });
  it("左结合链：默认值级联", () => {
    expect(evalExpr('optGet("nope") ?? optGet("cfg.ghost") ?? 3')).toBe(3);
  });
  it("优先级：?? 松于 || / && / 算术", () => {
    expect(evalExpr('optGet("nope") ?? 1 + 2')).toBe(3);
    expect(evalExpr('optGet("nope") ?? false || true')).toBe(true);
    expect(evalExpr('optGet("nope") ?? true && false')).toBe(false);
  });
  it("判别：左支非空时 ?? 分组为 x ?? (右支整体)，与 JS 一致", () => {
    // optGet("flag") ?? false || true = false ?? (false || true)：左支非空短路取 false；
    // 旧链（?? 比 || 紧）会先算 (false ?? false) || true = true，用 false 判别分组方向。
    expect(evalExpr('optGet("flag") ?? false || true')).toBe(false);
    expect(evalExpr("flag ?? false || true")).toBe(false);
    // 左结合不变：链式 ?? 仍从左往右折叠。
    expect(evalExpr('optGet("flag") ?? optGet("cfg.ghost") ?? 3')).toBe(false);
  });
  it("裸缺失路径 fail-closed（?? 不掩盖未知变量）", () => {
    expect(failCode("missing ?? 9")).toBe("unknown-variable");
  });
});

describe("路径型内建：optGet", () => {
  it("命中 / 缺失 / 中段缺失 / 整对象", () => {
    expect(evalExpr('optGet("cfg.speed")')).toBe(5);
    expect(evalExpr('optGet("cfg.ghost")')).toBe(null);
    expect(evalExpr('optGet("deep.x.y")')).toBe(null);
    expect(evalExpr('optGet("cfg")')).toEqual({ speed: 5, label: "快" });
  });
});

describe("路径型内建：arrayGet", () => {
  it("下标命中；越界 / 负下标 / 空数组 → null（越界与缺失同义）", () => {
    expect(evalExpr('arrayGet("bag", 0)')).toBe("剑");
    expect(evalExpr('arrayGet("bag", 2)')).toBe(null);
    expect(evalExpr('arrayGet("bag", -1)')).toBe(null);
    expect(evalExpr('arrayGet("empty", 0)')).toBe(null);
  });
});

describe("路径型内建：dictGet", () => {
  it("键命中；缺键 / 路径缺失 → null", () => {
    expect(evalExpr('dictGet("cfg", "speed")')).toBe(5);
    expect(evalExpr('dictGet("cfg", "ghost")')).toBe(null);
    expect(evalExpr('dictGet("nope", "k")')).toBe(null);
  });
});

describe("路径型内建：len", () => {
  it("数组 / 字符串长度；缺失路径 → null", () => {
    expect(evalExpr('len("bag")')).toBe(2);
    expect(evalExpr('len("cfg.label")')).toBe(1);
    expect(evalExpr('len("nope")')).toBe(null);
  });
});

describe("路径型内建 fail-closed（故意错误）", () => {
  it.each([
    "optGet(1)",
    'arrayGet("cfg", 0)', // 路径是字典不是数组
    'arrayGet("bag", "a")',
    'arrayGet("bag", 1.5)',
    'dictGet("bag", "k")', // 路径是数组不是字典
    'dictGet("cfg", 1)',
    'len("cfg")', // 字典没有长度
    'len("gold")',
  ])("%s → type-error", (src) => {
    expect(failCode(src)).toBe("type-error");
  });
  it("参数个数不符 → arity-error", () => {
    expect(failCode("optGet()")).toBe("arity-error");
    expect(failCode('arrayGet("bag")')).toBe("arity-error");
  });
  it("未知函数 fail-closed（含大小写敏感）", () => {
    expect(failCode("optget(1)")).toBe("unknown-function");
    expect(failCode("foo(1)")).toBe("unknown-function");
  });
});

describe("路径型内建与 ?? 组合（作者兜底书写）", () => {
  it("数组越界 / 缺键兜默认", () => {
    expect(evalExpr('arrayGet("empty", 0) ?? "空"')).toBe("空");
    expect(evalExpr('dictGet("cfg", "ghost") ?? 0')).toBe(0);
  });
});

describe("interpolateText：路径内建与 ??", () => {
  it("optGet 命中直插，缺失配 ?? 兜底", () => {
    expect(interpolateText('速度 {optGet("cfg.speed")}', resolve).text).toBe(
      "速度 5",
    );
    expect(
      interpolateText('称呼 {optGet("cfg.ghost") ?? "无名"}', resolve).text,
    ).toBe("称呼 无名");
  });
  it("未兜底的 null 插值保留原文并收集 type-error", () => {
    const { text, errors } = interpolateText(
      '速度 {optGet("cfg.ghost")}',
      resolve,
    );
    expect(text).toBe('速度 {optGet("cfg.ghost")}');
    expect(errors[0]?.code).toBe("type-error");
  });
});

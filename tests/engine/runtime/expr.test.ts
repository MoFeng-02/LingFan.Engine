/** 04-表达式求值测试（锚点：S4 非链式 / S5 类型错误 / S7 短路 / F4 转义） */
import { describe, expect, it } from "vitest";
import {
  evaluateExpression,
  ExpressionError,
  interpolateText,
} from "../../../packages/engine/src/runtime/expr";
import type { NameResolver } from "../../../packages/engine/src/runtime/resolver";

const vars = new Map<string, unknown>([
  ["gold", 7],
  ["player.hp", 30],
  ["stats", { mp: 5 }],
]);

/** 引擎侧名称解析语义的最小模拟：扁平优先 → 点路径字典下钻 */
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

describe("算术与优先级（04 §二.3）", () => {
  it.each([
    ["1+2*3", 7],
    ["(1+2)*3", 9],
    ["10/4", 2.5],
    ["7%3", 1],
    ["2-3-4", -5],
    ["1.5*2", 3],
    ["-(2+3)", -5],
    ["2*3%4", 2],
  ])("%s → %s", (src, expected) => {
    expect(evalExpr(src)).toBe(expected);
  });
  it("&& 优先于 ||", () => {
    expect(evalExpr("true && false || true")).toBe(true);
  });
});

describe("比较与相等（S4 非链式红线）", () => {
  it("1<2 / 2>=2 / 3!=4 / 1==1", () => {
    expect(evalExpr("1<2")).toBe(true);
    expect(evalExpr("2>=2")).toBe(true);
    expect(evalExpr("3!=4")).toBe(true);
    expect(evalExpr("1==1")).toBe(true);
  });
  it("同级连锁比较拒绝", () => {
    expect(failCode("1 == 2 == 3")).toBe("non-chained-comparison");
    expect(failCode("1 < 2 < 3")).toBe("non-chained-comparison");
  });
  it("跨类型 == 拒绝（S5）", () => {
    expect(failCode('"a" == 1')).toBe("type-error");
  });
});

describe("S7 短路：右支不被求值", () => {
  it("左支可短路时 resolver 零调用", () => {
    let calls = 0;
    const spy: NameResolver = (name) => {
      calls += 1;
      return resolve(name);
    };
    expect(evaluateExpression("true || nope", spy)).toBe(true);
    expect(evaluateExpression("false && nope", spy)).toBe(false);
    expect(calls).toBe(0);
  });
  it("需要右支时正常求值", () => {
    expect(evalExpr("false || true")).toBe(true);
    expect(evalExpr("true && false")).toBe(false);
  });
  it("操作数非 boolean → type-error", () => {
    expect(failCode("1 && true")).toBe("type-error");
    expect(failCode("false || 1")).toBe("type-error");
  });
});

describe("S5 fail-closed：类型错误 / 除零 / 未知名 / 内置函数守卫", () => {
  it.each(['1 + "a"', '!"x"', '1 < "a"', "true + 1", '"x" ? 1 : 2'])(
    "%s → type-error",
    (src) => {
      expect(failCode(src)).toBe("type-error");
    },
  );
  it.each(["1/0", "5 % 0"])("%s → division-by-zero（不静默 NaN）", (src) => {
    expect(failCode(src)).toBe("division-by-zero");
  });
  it("未定义变量", () => {
    expect(failCode("nope + 1")).toBe("unknown-variable");
    expect(failCode("stats.no")).toBe("unknown-variable");
  });
  it("未知函数 / 参数个数 / 参数类型 / 随机区间", () => {
    expect(failCode("foo(1)")).toBe("unknown-function");
    expect(failCode("min(1)")).toBe("arity-error");
    expect(failCode("random(1.5, 2)")).toBe("type-error");
    expect(failCode("random(6, 1)")).toBe("invalid-range");
  });
});

describe("成员路径（04 §二.9 点路径）", () => {
  it("扁平键与字典下钻", () => {
    expect(evalExpr("player.hp")).toBe(30);
    expect(evalExpr("stats.mp")).toBe(5);
  });
});

describe("内置函数（04 §二.6）", () => {
  it("min/max/abs/clamp", () => {
    expect(evalExpr("min(2,3)")).toBe(2);
    expect(evalExpr("max(2,3)")).toBe(3);
    expect(evalExpr("abs(-4)")).toBe(4);
    expect(evalExpr("clamp(5,0,3)")).toBe(3);
    expect(evalExpr("clamp(-1,0,3)")).toBe(0);
  });
  it("random 含端点且为整数", () => {
    for (let i = 0; i < 40; i += 1) {
      const v = evalExpr("random(1,6)");
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

describe("三元与字符串（F4 转义）", () => {
  it("1<2 ? 10 : 20 → 10", () => {
    expect(evalExpr("1<2 ? 10 : 20")).toBe(10);
  });
  it.each([
    ['"a\\nb"', "a\nb"],
    ['"a\\\\b"', "a\\b"],
    ['"a\\qb"', "a\\qb"], // F4：未知转义保留两字符原样
    ['"说\\"hi\\""', '说"hi"'],
  ])("%s → %s", (src, expected) => {
    expect(evalExpr(src)).toBe(expected);
  });
  it("空表达式 / 多余内容 → parse-error", () => {
    expect(failCode("")).toBe("parse-error");
    expect(failCode("1 2")).toBe("parse-error");
  });
});

describe("interpolateText（01 §三.4/§三.6，F7/S8）", () => {
  it("{expr} 求值与 {expr:format} 补零", () => {
    expect(
      interpolateText("金币 {gold:000}，翻倍 {gold * 2}", resolve).text,
    ).toBe("金币 007，翻倍 14");
  });
  it("三元含 '?' 时冒号不拆格式（老实现规则）", () => {
    expect(interpolateText("{gold > 5 ? 1 : 0}", resolve).text).toBe("1");
  });
  it("行内标记 {b}{/b}{p} 原样透传", () => {
    expect(interpolateText("{b}粗{/b}{p}尾", resolve).text).toBe(
      "{b}粗{/b}{p}尾",
    );
  });
  it("S8：插值失败保留原文片段并收集错误", () => {
    const { text, errors } = interpolateText("你好 {missing}！", resolve);
    expect(text).toBe("你好 {missing}！");
    expect(errors[0]?.code).toBe("unknown-variable");
  });
  it("多槽位混合：成功替换 + 失败保留", () => {
    const { text, errors } = interpolateText("{gold}-{nope}", resolve);
    expect(text).toBe("7-{nope}");
    expect(errors).toHaveLength(1);
  });
  it("无花括号文本原样返回", () => {
    expect(interpolateText("纯文本", resolve).text).toBe("纯文本");
  });
});

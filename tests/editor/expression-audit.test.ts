/**
 * 词汇层构建期轻类型校验守卫（expr/cond 组装审计）。
 *
 * 🔴 **规则表 ⇄ 引擎求值器逐条互锁**：每条误用样例同时断言①词汇层出警告、
 * ②引擎 `evaluateExpression` 对同一表达式文本真抛 `type-error`——警告的每一条
 * 都有引擎事实背书，规则表与引擎漂移即红。
 * 未知结构（函数调用/括号组/裸变量名）按 unknown 跳过——**零误报是本守卫的生命线**。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  cond,
  defineVars,
  drainExpressionWarnings,
  expr,
  type ExpressionWarning,
} from "../../packages/editor/src/script";
import { evaluateExpression } from "../../packages/engine/src/runtime/expr";

/** 注册表（每用例重新绑定——defineVars 是模块态）+ 取走本用例的警告 */
const vars = defineVars({
  gold: "num",
  hp: "num",
  name: "str",
  title: "str",
  isVIP: "bool",
  hasKey: "bool",
});
/** 每用例起手清池——前序用例失败也不泄漏警告到后续断言 */
beforeEach(() => {
  drainExpressionWarnings();
});
const warnings = (): readonly ExpressionWarning[] => drainExpressionWarnings();
const rules = (): string[] => warnings().map((w) => w.rule);

/** 引擎求值（互锁用）：剥掉 `{}` 包装后按注册值解析 */
const VALUES: Record<string, unknown> = {
  gold: 5,
  hp: 10,
  name: "灵泛",
  title: "旅者",
  isVIP: true,
  hasKey: false,
};
function engineThrowsType(expression: string): boolean {
  try {
    evaluateExpression(expression.slice(1, -1), (name) =>
      name in VALUES ? { found: true, value: VALUES[name] } : { found: false },
    );
    return false;
  } catch {
    return true;
  }
}

describe("词汇层轻类型校验 · 拟态正例（零误报是生命线）", () => {
  it("算术/比较/相等/逻辑/一元的全部正确形态 ⇒ 零警告", () => {
    expect(cond`${vars.gold} >= 25`).toBe("{gold >= 25}");
    expect(expr`${vars.hp} + ${vars.gold} * 2`).toBe("{hp + gold * 2}");
    expect(expr`${vars.name} == ${"灵泛"}`).toBe('{name == "灵泛"}');
    expect(expr`${vars.name} != "x"`).toBe('{name != "x"}');
    expect(cond`${vars.isVIP} && ${vars.hasKey}`).toBe("{isVIP && hasKey}");
    expect(cond`${vars.isVIP} || ${vars.gold} == 1`).toBe(
      "{isVIP || gold == 1}",
    );
    expect(cond`!${vars.isVIP}`).toBe("{!isVIP}");
    expect(expr`-${vars.gold}`).toBe("{-gold}");
    expect(rules()).toEqual([]);
  });

  it("未知结构不参与判类 ⇒ 无从误报", () => {
    expect(expr`min(${vars.hp}, 10)`).toBe("{min(hp, 10)}");
    expect(expr`clamp(${vars.hp}, 1, 100) >= 1`).toBe(
      "{clamp(hp, 1, 100) >= 1}",
    );
    expect(expr`score >= 10`).toBe("{score >= 10}"); // 手写裸变量 = unknown
    expect(expr`${vars.isVIP} ? 1 : 2`).toBe("{isVIP ? 1 : 2}"); // 三元：结构标点
    expect(rules()).toEqual([]);
  });

  it("字符串字面量里的运算符不进 token 流 ⇒ 零误报", () => {
    expect(expr`${vars.name} == "&& || + *"`).toBe('{name == "&& || + *"}');
    expect(expr`${vars.name} == 'a"b'`).toBe("{name == 'a\"b'}");
    expect(rules()).toEqual([]);
  });
});

describe("词汇层轻类型校验 · 故意错误（每条规则 ↔ 引擎 type-error 互锁）", () => {
  /** 断言：词汇层恰好一条该规则警告 + 引擎对同一表达式真抛 type-error */
  function expectMisuse(rule: ExpressionWarning["rule"], built: string): void {
    const hits = warnings();
    expect(hits, `${built} 应恰好一条警告`).toHaveLength(1);
    expect(hits[0]!.rule).toBe(rule);
    expect(hits[0]!.expression).toBe(built);
    // 🔴 互锁：警告背后必须有引擎事实——同文本真求值必须抛错
    expect(engineThrowsType(built), `引擎应拒绝：${built}`).toBe(true);
  }

  it("算术族：str/bool 操作数 ⇒ arith-non-num（引擎 `+` 无字符串拼接）", () => {
    expectMisuse("arith-non-num", expr`${vars.name} + 1`);
    expectMisuse("arith-non-num", expr`${vars.gold} * "倍"`);
    expectMisuse("arith-non-num", expr`${vars.isVIP} - 1`);
  });

  it("比较族：str 操作数 ⇒ compare-non-num（引擎比较只支持 number）", () => {
    expectMisuse("compare-non-num", cond`${vars.name} >= 1`);
    expectMisuse("compare-non-num", cond`1 <= ${vars.title}`);
  });

  it("相等族：跨类型 ⇒ equality-kind-mismatch（引擎仅同类型标量相等）", () => {
    expectMisuse("equality-kind-mismatch", expr`${vars.gold} == ${vars.name}`);
    expectMisuse("equality-kind-mismatch", expr`${vars.hp} != true`);
  });

  it("逻辑族：非 bool 操作数 ⇒ logical-non-bool（引擎 && / || 严格 boolean）", () => {
    expectMisuse("logical-non-bool", cond`${vars.gold} && ${vars.isVIP}`);
    // 右支互锁取「必被求值」的形态：|| 左支 false 不短路；&& 左支 true 不短路
    expectMisuse("logical-non-bool", cond`false || ${vars.gold}`);
    expectMisuse("logical-non-bool", cond`${vars.isVIP} && ${vars.gold}`);
    expectMisuse("unary-not-non-bool", cond`!${vars.name}`);
    expectMisuse("unary-minus-non-num", expr`-${vars.name}`);
  });
});

describe("词汇层轻类型校验 · 边界条件", () => {
  it("🔴 插值落进未闭合字面量 ⇒ interpolation-inside-string（吞并 footgun；产物保真零侵入）", () => {
    const built = expr`"pre${vars.name}post"`;
    expect(built).toBe('{"prenamepost"}'); // 键被并进字面量——产物与既有行为一致
    const hits = warnings();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.rule).toBe("interpolation-inside-string");
  });

  it("🔴 字面量至表达式末尾未闭合 ⇒ unclosed-string-literal 且不做类型核查", () => {
    const built = expr`${vars.gold} + "尾巴`;
    const hits = warnings();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.rule).toBe("unclosed-string-literal");
    expect(hits[0]!.expression).toBe(built);
  });

  it("转义引号不打断字面量 ⇒ 无警告", () => {
    expect(expr`${vars.name} == "a\\"b"`).toBe('{name == "a\\"b"}');
    expect(rules()).toEqual([]);
  });

  it("字面量闭合后接运算符 ⇒ 正常进入类型核查（字面量 + number = 引擎必拒）", () => {
    const built = expr`"前缀" + ${vars.gold}`;
    expect(built).toBe('{"前缀" + gold}');
    expect(rules()).toEqual(["arith-non-num"]);
  });
});

describe("词汇层轻类型校验 · 回归锚定", () => {
  it("🔴 drain 即清零：连续两次调用第二次必空", () => {
    const built = expr`${vars.name} + 1`;
    expect(built).toBe("{name + 1}");
    expect(drainExpressionWarnings()).toHaveLength(1);
    expect(drainExpressionWarnings()).toEqual([]);
  });

  it("🔴 审计零侵入：产物文本与既有行为逐字节一致", () => {
    expect(expr`${vars.gold} + ${1}`.slice(1, -1)).toBe("gold + 1");
    expect(expr`${vars.isVIP}`).toBe("{isVIP}");
    expect(cond`${vars.gold} >= 25`).toBe("{gold >= 25}"); // cond = 同一实现
  });

  it("🔴 fail-closed 不放松：未注册句柄照旧抛错", () => {
    // 未注册子树（Proxy）判不出句柄 ⇒ 走「不支持的插值类型」人话报错，指回 defineVars
    expect(() => expr`${(vars as { nope: unknown }).nope} + 1`).toThrow(
      /defineVars/,
    );
    const saved = drainExpressionWarnings();
    expect(saved).toEqual([]);
  });
});

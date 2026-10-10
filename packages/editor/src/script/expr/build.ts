/**
 * 表达式标签的装配：把模板字面量拼成 `{…}` 文本，插值按句柄与字面量规则渲染。
 *
 * 组装同时做构建期轻类型校验（判类器在 `./audit`）：警告进池、由
 * `drainExpressionWarnings` 取走；表达式产物与既有行为逐字节一致（校验零侵入）。
 */

import {
  currentRegistry,
  isVarHandle,
  varKeyOf,
  warningSink,
  type ExpressionWarning,
  type VarKind,
} from "./registry";
import { ExpressionAuditor, type AuditToken, type OperandKind } from "./audit";

/**
 * 表达式标签：`expr\`${vars.player.gold} >= 25\` ⇒ "{player.gold >= 25}"`。
 * 插值规则：VarHandle ⇒ 注册键（未注册抛错）；number/boolean ⇒ 字面量；
 * string ⇒ JSON 字面量（带引号，与引擎字符串字面量口径一致）。
 *
 * 组装同时做轻类型校验（见文件头）：警告进池，由 `drainExpressionWarnings` 取走；
 * 表达式产物与既有行为逐字节一致（校验零侵入）。
 */
export function expr(
  strings: TemplateStringsArray,
  ...parts: unknown[]
): string {
  const registry = currentRegistry;
  if (registry === null) {
    throw new Error("expr 需要先 defineVars（变量注册是表达式句柄的前提）");
  }
  const tokens: AuditToken[] = [];
  const pending: Array<{ rule: ExpressionWarning["rule"]; message: string }> =
    [];
  // 引号状态跨片段/插值跟踪（`"pre${name}post"` 的吞并 footgun：插值会被并进字面量）
  let quote: string | null = null;
  let escaped = false;

  /** 片段词法：引号（跨片段）、双字运算符优先、字面量/数字/标识符；括号与结构标点进流 */
  const lexFragment = (segment: string): void => {
    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i]!;
      if (quote !== null) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        tokens.push({ t: "operand", kind: "str", label: "字符串字面量" });
        continue;
      }
      const two = segment.slice(i, i + 2);
      if (
        two === "==" ||
        two === "!=" ||
        two === "&&" ||
        two === "||" ||
        two === ">=" ||
        two === "<="
      ) {
        tokens.push({ t: "op", text: two });
        i += 1;
        continue;
      }
      if ("+-*/%<>!".includes(ch)) {
        tokens.push({ t: "op", text: ch });
        continue;
      }
      if ("(),?:.[]".includes(ch)) {
        tokens.push({ t: "punct", text: ch });
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i;
        while (j < segment.length && /[0-9.]/.test(segment[j]!)) j += 1;
        const literal = segment.slice(i, j);
        i = j - 1;
        tokens.push({ t: "operand", kind: "num", label: literal });
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        let j = i;
        while (j < segment.length && /[A-Za-z0-9_]/.test(segment[j]!)) j += 1;
        const word = segment.slice(i, j);
        i = j - 1;
        tokens.push(
          word === "true" || word === "false"
            ? { t: "operand", kind: "bool", label: word }
            : { t: "operand", kind: "unknown", label: word },
        );
        continue;
      }
      // 其余字符（空白等）：词法噪声，不进流
    }
  };

  /** 插值贡献（文本 + 判类）：产物文本与既有行为逐字节一致（校验零侵入） */
  const appendPart = (
    part: unknown,
  ): { text: string; kind: OperandKind; label: string } => {
    if (isVarHandle(part)) {
      const key = varKeyOf(part, registry);
      return { text: key, kind: part.kind, label: `变量 ${key}` };
    }
    if (typeof part === "number" || typeof part === "boolean") {
      return {
        text: String(part),
        kind: typeof part as VarKind,
        label: String(part),
      };
    }
    if (typeof part === "string") {
      return {
        text: JSON.stringify(part),
        kind: "str",
        label: JSON.stringify(part),
      };
    }
    throw new Error(
      `expr 不支持的插值类型：${typeof part}——若是变量句柄，请确认已在 defineVars 注册`,
    );
  };

  let out = "{";
  strings.forEach((segment, i) => {
    lexFragment(segment);
    out += segment;
    if (i >= parts.length) return;
    const part = parts[i];
    if (quote !== null) {
      // 校验零侵入：警告照记，但文本照旧并入产物（与既有行为逐字节一致）
      pending.push({
        rule: "interpolation-inside-string",
        message:
          "插值落在字符串字面量内部（引号未闭合）——插值文本会被并进字面量，不会成为表达式操作数",
      });
      out += appendPart(part).text;
      return;
    }
    const applied = appendPart(part);
    out += applied.text;
    tokens.push({ t: "operand", kind: applied.kind, label: applied.label });
  });

  const finalize = (): string => `${out}}`;
  if (quote !== null) {
    // 字面量到表达式末尾都没闭合：引擎将 parse-error——类型核查无意义，只报这一条
    pending.push({
      rule: "unclosed-string-literal",
      message: "表达式存在未闭合的字符串字面量（引擎将 parse-error）",
    });
    warningSink.push(
      ...pending.map((item) => ({ expression: finalize(), ...item })),
    );
    return finalize();
  }
  new ExpressionAuditor(tokens, pending).audit();
  for (const item of pending) {
    warningSink.push({ expression: finalize(), ...item });
  }
  return finalize();
}

/** `expr` 的别名（条件语境的语义化写法；同一实现、同一校验） */
export const cond = expr;

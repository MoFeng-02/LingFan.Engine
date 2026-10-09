/**
 * 文本插值：把 {expr} 求值替换、{expr:format} 格式化。
 *
 * 行内富文本标记原样透传给渲染层；插值失败保留原文片段并收集错误。
 */
import type { NameResolver } from "../resolver";
import { evaluateExpression } from "./evaluate";
import { ExpressionError, type ExprValue } from "./value";

/** 行内富文本标记（单一真相源）：这些 {…} 原样透传给渲染层 */
const INLINE_SHORT_TAGS = new Set([
  "b",
  "/b",
  "i",
  "/i",
  "u",
  "/u",
  "w",
  "fast",
  "p",
  "color",
  "font",
  "size", // 裸标签名（用户可能写 {color} 作为闭合）
]);
/** 带参行内标记前缀集（`color=` / `font=` / `size=` 及闭合形式）；与 INLINE_SHORT_TAGS 共同构成 isInlineTag 判据 */
const INLINE_PREFIXED_TAGS = [
  "color=",
  "/color",
  "font=",
  "/font",
  "size=",
  "/size",
];

/** 判断 {…} 内容是否是行内富文本标记（短标签名，或 color=/font=/size= 这类前缀标签） */
function isInlineTag(content: string): boolean {
  if (INLINE_SHORT_TAGS.has(content)) return true;
  return INLINE_PREFIXED_TAGS.some((p) => content.startsWith(p));
}

/** 插值结果：text 是替换后文本（失败片段保留原文），errors 收集全部求值失败 */
export interface TextInterpolation {
  text: string;
  errors: ExpressionError[];
}

/**
 * 文本插值：{expr} 求值替换、{expr:format} 格式化（仅文本命令走此路径）；
 * 行内标记原样透传；插值失败保留原文片段 + 收集错误。
 * 格式符语义：全 0 → 按位数补零；X/x → 十六进制；其余原样。
 */
export function interpolateText(
  text: string,
  resolve: NameResolver,
  rng: () => number = Math.random,
): TextInterpolation {
  if (!text.includes("{")) return { text, errors: [] };
  let out = "";
  const errors: ExpressionError[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      out += ch;
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) {
      out += text.slice(i);
      break;
    }
    const content = text.slice(i + 1, end).trim();
    // 格式后缀拆分：{mins:00} → expr=mins, format=00；含 '?'（三元）不拆
    let exprSrc = content;
    let format: string | null = null;
    if (!content.includes("?")) {
      const colon = content.indexOf(":");
      if (colon > 0) {
        format = content.slice(colon + 1).trim();
        exprSrc = content.slice(0, colon).trim();
      }
    }
    try {
      out += applyFormat(evaluateExpression(exprSrc, resolve, rng), format);
    } catch (e) {
      if (e instanceof ExpressionError) {
        if (isInlineTag(content)) {
          // 冲突消解：已定义变量 > 行内标记（{i} 在 i 未定义时是斜体标记，已定义时是变量）
          out += text.slice(i, end + 1);
        } else {
          errors.push(e);
          out += text.slice(i, end + 1); // 保留原文片段
        }
      } else {
        throw e;
      }
    }
    i = end + 1;
  }
  return { text: out, errors };
}

/**
 * 把求值结果转成展示文本：复合值报错；格式符只对整数 number 生效
 * （全 0 = 按位数补零，X/x = 十六进制，未知格式原样返回）。
 */
function applyFormat(value: ExprValue, format: string | null): string {
  let s: string;
  if (typeof value === "number") s = String(value);
  else if (typeof value === "boolean") s = value ? "true" : "false";
  else if (typeof value === "string") s = value;
  else throw new ExpressionError("type-error", "文本插值不支持数组/字典值");
  if (format === null || typeof value !== "number" || !Number.isInteger(value))
    return s;
  if (/^0+$/.test(format)) return s.padStart(format.length, "0");
  if (format === "X") return value < 0 ? s : value.toString(16).toUpperCase();
  if (format === "x") return value < 0 ? s : value.toString(16);
  return s; // 未知格式符原样返回
}

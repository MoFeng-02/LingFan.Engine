/**
 * 词法：把表达式源文本切成标记序列。
 *
 * 字符串里的已知转义按映射还原，未知转义保留两字符原样（Windows 路径兼容）。
 */
import { ExpressionError } from "./value";

/** 一个词法标记：kind 判类型，text 是原文切片，数值/字符串另在 value 上存解析结果 */
export interface Token {
  kind: "num" | "str" | "ident" | "op" | "eof";
  text: string;
  value?: number | string;
}

/** 双字符运算符：`==` `!=` `>=` `<=` `&&` `||` */
const TWO_CHAR_OPS = ["==", "!=", ">=", "<=", "&&", "||"];
/** 单字符运算符与分组符号：`>` `<` `!` `?` `:` `+` `-` `*` `/` `%` `(` `)` `,` `.` */
const ONE_CHAR_OPS = [
  ">",
  "<",
  "!",
  "?",
  ":",
  "+",
  "-",
  "*",
  "/",
  "%",
  "(",
  ")",
  ",",
  ".",
];

/** 已知转义映射；未知转义保留两字符原样（Windows 路径兼容） */
const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/** 把表达式源文本切成标记序列（末尾必带一个 eof）；遇到无法识别的字符抛 parse-error */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isIdentStart = (c: string) => /[A-Za-z_\u4e00-\u9fa5]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_\u4e00-\u9fa5]/.test(c);

  while (i < src.length) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < src.length && isDigit(src[j]!)) j += 1;
      if (src[j] === "." && j + 1 < src.length && isDigit(src[j + 1]!)) {
        j += 2;
        while (j < src.length && isDigit(src[j]!)) j += 1;
      }
      const text = src.slice(i, j);
      tokens.push({ kind: "num", text, value: Number(text) });
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = "";
      let closed = false;
      while (j < src.length) {
        const c = src[j]!;
        if (c === '"') {
          closed = true;
          j += 1;
          break;
        }
        if (c === "\\") {
          const next = src[j + 1];
          if (next === undefined)
            throw new ExpressionError("parse-error", "字符串转义不完整");
          out += ESCAPES[next] ?? `\\${next}`; // 未知转义保留两字符
          j += 2;
          continue;
        }
        out += c;
        j += 1;
      }
      if (!closed) throw new ExpressionError("parse-error", "字符串未闭合");
      tokens.push({ kind: "str", text: src.slice(i, j), value: out });
      i = j;
      continue;
    }
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j]!)) j += 1;
      tokens.push({ kind: "ident", text: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ kind: "op", text: two });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ kind: "op", text: ch });
      i += 1;
      continue;
    }
    throw new ExpressionError(
      "parse-error",
      `无法识别的字符：${JSON.stringify(ch)}`,
    );
  }
  tokens.push({ kind: "eof", text: "" });
  return tokens;
}

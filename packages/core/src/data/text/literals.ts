/**
 * 字面量与文本投影原语：值的解析（字面量 → 值）与值的投影（值 → 文本）。
 * 两个方向成对放在一起，改一处即为往返等价性的唯一入口。
 */
import { unquote, escapeForText } from "./lexer.ts";
import { TextFormatError } from "./error.ts";
import type { StoryCommand } from "../../contracts/index.ts";

/** set/define 类的值：原样透传（{expr} 复合赋值等由执行器窄化） */
export function parseValueLiteral(raw: string): unknown {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return unquote(t);
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return t; // {expr} / += 复合 / 裸词 → 原样字符串（执行器 evalValue 语义）
}

/** [a, "b", {expr}] 数组字面量 → items（每项走 parseValueLiteral 语义） */
export function parseArrayLiteral(raw: string): unknown[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const items: unknown[] = [];
  let cur = "";
  let inString = false;
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        cur += inner[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cur += ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      if (cur.trim() !== "") items.push(parseValueLiteral(cur));
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") items.push(parseValueLiteral(cur));
  return items;
}

/** 提取 `keyword {…}` 字典字面量（花括号计数支持嵌套/引号内大括号）；返回字面量与剥离后的余文 */
export function extractDictLiteral(
  source: string,
  keyword: string,
): { literal: string; remainder: string } | null {
  const at = source.indexOf(`${keyword} {`);
  if (at < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = at + keyword.length; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  return {
    literal: source.slice(at + keyword.length, end + 1).trim(),
    remainder: source.slice(0, at) + source.slice(end + 1),
  };
}

/** 提取 `key={…}` 形式的字典字面量（与 `extractDictLiteral` 同法计花括号，便于 `key=值` 语法） */
export function extractKeyedDictLiteral(
  source: string,
  key: string,
): { literal: string; remainder: string } | null {
  const at = source.indexOf(`${key}=`);
  if (at < 0) return null;
  const braceAt = source.indexOf("{", at + key.length + 1);
  if (braceAt < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = braceAt; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  return {
    literal: source.slice(braceAt, end + 1),
    // 保留 key= 之前的内容（目标等位置参）与闭合花括号之后的内容
    remainder: `${source.slice(0, at)} ${source.slice(end + 1)}`,
  };
}

/**
 * 提取 `key=[…]` 形式的数组字面量（方括号计数，引号内的括号不算）。
 *
 * 与 `extractKeyedDictLiteral` 同法，只是括号类型不同；`key` 只认**字符串外**且前面是空白
 * 或行首的那一处（避免提示语里恰好出现 `options=` 被误当参数）。
 * 返回字面量与剥离后的余文；找不到或不闭合返回 `null`。
 */
export function extractKeyedArrayLiteral(
  source: string,
  key: string,
): { literal: string; remainder: string } | null {
  const at = findKeyOutsideString(source, key);
  if (at < 0) return null;
  const bracketAt = source.indexOf("[", at + key.length + 1);
  if (bracketAt < 0) return null;
  let depth = 0;
  let end = -1;
  let inString = false;
  for (let i = bracketAt; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  return {
    literal: source.slice(bracketAt, end + 1),
    remainder: `${source.slice(0, at)} ${source.slice(end + 1)}`,
  };
}

/** 找 `key=` 在字符串外、且位于行首或空白之后的位置；找不到返回 -1 */
function findKeyOutsideString(source: string, key: string): number {
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (
      source.startsWith(`${key}=`, i) &&
      (i === 0 || /\s/.test(source[i - 1]!))
    ) {
      return i;
    }
  }
  return -1;
}

/**
 * `[{"text": …, "value": …}, …]` 数组字面量 → 输入候选表。
 *
 * 与 `generateInputOptions` 严格互逆（往返字节级一致）；字段不是字符串的项原样保留为
 * `undefined` 之外的空串，交由校验层报错——解析器不替作者猜。
 */
export function parseInputOptionsLiteral(
  raw: string,
): Array<{ text: string; value: string }> {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const parts: string[] = [];
  let cur = "";
  let inString = false;
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        cur += inner[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cur += ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      if (cur.trim() !== "") parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((part) => {
    const dict = parseDictLiteral(part);
    return {
      text: typeof dict.text === "string" ? dict.text : "",
      value: typeof dict.value === "string" ? dict.value : "",
    };
  });
}

/**
 * 输入候选表的文本投影：`[{"text": "…", "value": "…"}, …]`。
 *
 * 与 `parseInputOptionsLiteral` 严格互逆；每项经 `generateDictLiteral`（键序 text → value，
 * 插入序确定，故同一份数据两次投影字节相同）。
 */
export function generateInputOptions(
  options: readonly { text: string; value: string }[],
): string {
  const items = options.map((item) =>
    generateDictLiteral({ text: item.text, value: item.value }),
  );
  return `[${items.join(", ")}]`;
}

/** {"f":v} 字典字面量 → 对象（字段值走 parseValueLiteral 语义） */
export function parseDictLiteral(raw: string): Record<string, unknown> {
  const inner = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
  const out: Record<string, unknown> = {};
  const parts: string[] = [];
  let cur = "";
  let inString = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (inString) {
      cur += ch;
      if (ch === "\\") {
        cur += inner[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const key = unquote(part.slice(0, colon).trim());
    out[key] = parseValueLiteral(part.slice(colon + 1).trim());
  }
  return out;
}

/**
 * 实例级 z 的文本投影：`z=20`（写端统一用 `z=`；读端兼容别名 `z-index=`）。
 * 未指定 → 不输出（保持既有文本逐字节稳定）。
 */
export function instanceZText(cmd: StoryCommand): string {
  return typeof cmd.z === "number" ? ` z=${cmd.z}` : "";
}

/**
 * 字符串字段投影（**生成器唯一字符串入口**）：非字符串 = 该命令不可投影，
 * 抛 `TextFormatError` 让 `projectText` 降级为 issue——
 * 编辑器里「插入了命令但必填字段还空着」是常态，绝不能让半个命令把整棵树带崩
 * （`escapeForText(undefined)` 会抛 TypeError ⇒ 文本视图崩、整页失活）。
 */
export function quoteForText(value: unknown): string {
  if (typeof value !== "string") {
    throw new TextFormatError([
      `文本投影缺少字符串字段（收到 ${value === undefined ? "缺失" : typeof value}）`,
    ]);
  }
  return `"${escapeForText(value)}"`;
}

/**
 * 把一个命令字段值投影成文本字面量。
 *
 * 数字与布尔原样写出；字符串若形如 `{表达式}` 或复合赋值前缀（`+=` 等）原样透传
 * （执行器求值语义，加引号会改变含义），其余字符串按字面量加引号；
 * 对象/数组走 `JSON.stringify` 后加引号。
 * 非字符串以外都能投影，故本函数不会抛错。
 */
export function generateValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") {
    // {expr} 与复合赋值前缀原样透传（执行器求值语义）；其余字符串 = 字面量 → 加引号
    if (/^\{.*\}$/.test(value) || /^\s*(\+=|-=|\*=|\/=|%=)/.test(value))
      return value;
    return quoteForText(value);
  }
  return quoteForText(JSON.stringify(value));
}

/**
 * 把字典字段投影成 `{ "键": 值, … }` 字面量，每个值经 `generateValue` 处理。
 *
 * 字段缺失或不是对象 = 不可投影，抛 `TextFormatError`；
 * 上层按命令粒度捕获后降级为 issue，不会让半个命令带崩整棵树。
 */
export function generateDictLiteral(value: Record<string, unknown>): string {
  // 同 quoteForText：字典字段缺失 = 不可投影（降级为 issue，不让半个命令带崩整棵树）
  if (value === null || typeof value !== "object") {
    throw new TextFormatError([
      `文本投影缺少字典字段（收到 ${value === undefined ? "缺失" : typeof value}）`,
    ]);
  }
  const fields = Object.entries(value).map(
    ([k, v]) => `${quoteForText(k)}: ${generateValue(v)}`,
  );
  return `{${fields.join(", ")}}`;
}

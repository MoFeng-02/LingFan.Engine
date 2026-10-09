/**
 * 字面量与文本投影原语：值的解析（字面量 → 值）与值的投影（值 → 文本）。
 * 两个方向成对放在一起，改一处即为往返等价性的唯一入口。
 */
import { unquote, escapeForText } from "./lexer";
import { TextFormatError } from "./error";
import type { StoryCommand } from "../../contracts";

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

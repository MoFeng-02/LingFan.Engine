/**
 * scene 列内的元素行读向解析：`类型 "内容" key=value …`。
 * 与语句 op 同名的元素类型只能显式写 `element` 前缀（见 ELEMENT_OP_CONFLICTS）。
 */
import { unquote } from "../lexer";
import { isElementType, type ElementNode } from "../../../contracts";

// ====== 元素行（scene 列内）：`类型 "内容" key=value …` ======

/**
 * 同时是「元素类型」与「语句 op」的名字——语句优先于元素兜底（
 * `popup` 元素行不可达）。这些名字在文本里一律按 op 解析；要写同名元素请用 JSON 形态。
 */
export const ELEMENT_OP_CONFLICTS = new Set(["video", "background", "window"]);

/** 图像类元素的位置参归属 `source`，其余归 `text` */
export const ELEMENT_SOURCE_TYPES = new Set(["image", "background", "portrait"]);

/** 属性值：true/false → 布尔；纯数字 → 数字；其余去引号原样（同语义） */
export function parseElementAttrValue(raw: string): unknown {
  const text = raw.startsWith('"') ? unquote(raw) : raw;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

/**
 * 元素行 → `ElementNode`（36 类型 + 属性全集）。
 * 位置参 `"内容"` 按类型归属（图像类 → `source`，其余 → `text`）；属性合法性由解析期兜底。
 */
export function parseElementLine(
  tokens: string[],
  at: string,
  issues: string[],
): ElementNode | null {
  const type = tokens[0] ?? "";
  if (!isElementType(type)) return null;
  const node: ElementNode = { type };
  for (const token of tokens.slice(1)) {
    if (token.startsWith('"')) {
      const content = unquote(token);
      if (ELEMENT_SOURCE_TYPES.has(type)) node.source = content;
      else node.text = content;
      continue;
    }
    const eq = token.indexOf("=");
    if (eq <= 0) {
      issues.push(`${at}: 元素行无法识别的参数：${token}`);
      continue;
    }
    const key = token.slice(0, eq);
    node[key] = parseElementAttrValue(token.slice(eq + 1));
  }
  return node;
}

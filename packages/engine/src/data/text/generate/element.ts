/** 元素节点的文本投影（scene 列的空间层）。 */
import { ELEMENT_OP_CONFLICTS } from "../parse/element";
import { quoteForText } from "../literals";
import type { ElementNode } from "../../../contracts";

/** 元素属性值 → 文本（布尔/数字裸串；含空白的字符串加引号，保证往返等价） */
export function elementValueText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const text = String(value);
  return /\s/.test(text) ? quoteForText(text) : text;
}

/**
 * `ElementNode` → 元素行：`类型 "内容" key=value …`。
 * 确定性输出：位置参（`source` 优先，其次 `text`）紧接类型名，其余键按插入序；children 缩进 2 空格。
 *
 * **同名冲突类型加 `element ` 前缀**（`ELEMENT_OP_CONFLICTS`）：裸写会被「语句优先」回读成同名
 * op（见 `parseCommands`），加前缀后元素与 op 两侧都可达，往返精确。其余类型裸写，
 * 与既有文本写法保持一致（不制造无谓改动）。
 */
export function generateElement(node: ElementNode, pad: string, out: string[]): void {
  const tokens: string[] = ELEMENT_OP_CONFLICTS.has(node.type)
    ? ["element", node.type]
    : [node.type];
  const positional =
    typeof node.source === "string"
      ? node.source
      : typeof node.text === "string"
        ? node.text
        : undefined;
  if (positional !== undefined) tokens.push(quoteForText(positional));
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "children") continue;
    if (key === "text" || key === "source") continue; // 已作位置参输出
    tokens.push(`${key}=${elementValueText(value)}`);
  }
  out.push(`${pad}${tokens.join(" ")}`);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      generateElement(child as ElementNode, `${pad}  `, out);
    }
  }
}

/**
 * 08 §四.3 UI 职责：内联富文本标记解析渲染（核心层只透传，本模块负责上屏）。
 * 标记集 = 老引擎 DslInlineTags 单一真相源照搬：
 * - 样式：{b}{/b} {i}{/i} {u}{/u} {color=#xxx}{/color} {font=名}{/font} {size=N}{/size}
 * - 控制符：{p}/{w} 段内停顿、{fast}——打字机阶段接管（08-U3），当前渲染为空
 * - 裸 {color}{font}{size} 按闭合处理（老引擎语义）
 * - 未知 {…}（含用户字面量）按原文渲染；HTML 全量转义防注入
 */

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** color 值白名单：#hex 或 CSS 颜色名词汇（防 style 注入） */
function sanitizeColor(v: string): string | null {
  return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]+$/.test(v) ? v : null;
}

/** size 值：纯数字 → px */
function sanitizeSize(v: string): string | null {
  return /^\d+(\.\d+)?$/.test(v) ? `${v}px` : null;
}

/** font 值：字母数字/空格/中文/逗号（防引号逃逸与分号注入） */
function sanitizeFont(v: string): string | null {
  return /^[\w\u4e00-\u9fa5 ,]+$/.test(v) ? v : null;
}

const CLOSERS = new Set([
  "/b",
  "/i",
  "/u",
  "/color",
  "/font",
  "/size",
  "color",
  "font",
  "size",
]);

/** 渲染内联标记为安全 HTML（配 v-html 使用；所有文本内容均转义） */
export function renderInlineMarkup(text: string): string {
  let html = "";
  const stack: string[] = []; // 未闭合标记对应的闭合串
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch !== "{") {
      html += escapeHtml(ch);
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) {
      html += escapeHtml(text.slice(i));
      break;
    }
    const content = text.slice(i + 1, end).trim();
    i = end + 1;
    if (content === "") continue;

    if (CLOSERS.has(content)) {
      const close = stack.pop();
      if (close !== undefined) html += close;
      continue;
    }
    if (content === "p" || content === "w" || content === "fast") continue; // 打字机阶段接管

    if (content.startsWith("color=")) {
      const color = sanitizeColor(content.slice(6).trim());
      if (color !== null) {
        stack.push("</span>");
        html += `<span style="color:${color}">`;
      }
      continue;
    }
    if (content.startsWith("size=")) {
      const size = sanitizeSize(content.slice(5).trim());
      if (size !== null) {
        stack.push("</span>");
        html += `<span style="font-size:${size}">`;
      }
      continue;
    }
    if (content.startsWith("font=")) {
      const font = sanitizeFont(content.slice(5).trim());
      if (font !== null) {
        stack.push("</span>");
        html += `<span style="font-family:'${font}'">`;
      }
      continue;
    }
    if (content === "b" || content === "i" || content === "u") {
      stack.push(`</${content}>`);
      html += `<${content}>`;
      continue;
    }
    // 未知 {…}：变量插值已在核心层完成，这里按字面保留
    html += escapeHtml(`{${content}}`);
  }
  while (stack.length > 0) html += stack.pop()!; // 未闭合标记容错补齐
  return html;
}

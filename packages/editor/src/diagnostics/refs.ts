/**
 * 表达式引用抽取（纯函数，零依赖）：
 * 从故事文本 / 字段值里剥出会被求值的表达式源，并抽出其中的变量键引用。
 * 供符号索引（./symbols）按字段形态调用；extractExpressionRefs 经
 * ../diagnostics/index.ts 对外转发。
 */

/** 行内富文本标记（镜像 packages/engine/src/runtime/expr/interpolate.ts；行为互锁见 tests/editor/schema.test.ts） */
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
  "size",
]);
const INLINE_PREFIXED_TAGS = [
  "color=",
  "/color",
  "font=",
  "/font",
  "size=",
  "/size",
];

function isInlineTag(content: string): boolean {
  if (INLINE_SHORT_TAGS.has(content)) return true;
  return INLINE_PREFIXED_TAGS.some((prefix) => content.startsWith(prefix));
}

/** 表达式内置名与字面量 */
const EXPR_BUILTINS = new Set([
  "random",
  "min",
  "max",
  "abs",
  "clamp",
  "true",
  "false",
]);
const IDENT_PATH_RE =
  /[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]*(?:\.[A-Za-z_][A-Za-z0-9_\u4e00-\u9fa5]*)*/g;

/** 表达式中的变量键引用（点路径整键 = 全局键路径/字典下钻；跳过字符串字面量/数字尾巴/内置名） */
export function extractExpressionRefs(expr: string): string[] {
  let stripped = "";
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '"') {
      i += 1;
      while (i < expr.length) {
        if (expr[i] === "\\") {
          i += 2;
          continue;
        }
        if (expr[i] === '"') break;
        i += 1;
      }
      continue;
    }
    stripped += ch;
  }
  const refs: string[] = [];
  for (const match of stripped.matchAll(IDENT_PATH_RE)) {
    const name = match[0];
    const prev = stripped.slice(0, match.index ?? 0).trimEnd();
    if (/\d$/.test(prev)) continue;
    if (EXPR_BUILTINS.has(name)) continue;
    if (!refs.includes(name)) refs.push(name);
  }
  return refs;
}

/** 引号字符串字面量剔除后的 {…} 段求值源提取（插值面：先判行内标记，再剥格式后缀） */
export function exprSourcesInText(text: string): string[] {
  const sources: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i += 1;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) break;
    const content = text.slice(i + 1, end).trim();
    if (!isInlineTag(content)) {
      let exprSrc = content;
      if (!content.includes("?")) {
        const colon = content.indexOf(":");
        if (colon > 0) exprSrc = content.slice(0, colon).trim();
      }
      sources.push(exprSrc);
    }
    i = end + 1;
  }
  return sources;
}

/** 表达式面源提取（cond/on/in：{…} 包装剥壳，与执行器 evalCond 同构） */
export function exprSourceInExpressionField(raw: string): string {
  const t = raw.trim();
  return t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : t;
}

const COMPOUND_PREFIX = /^\s*(\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/;

/** value 字段源提取（{expr} 包装或复合赋值右部；其余 = 字面量无引用），与执行器 evalValue/execAssign 同构 */
export function exprSourceInValueField(raw: string): string | null {
  const compound = COMPOUND_PREFIX.exec(raw);
  if (compound !== null) return compound[2];
  const t = raw.trim();
  return t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : null;
}

/**
 * 引擎文本字面量的渲染：把构建期已知值写成引擎源码里的字面量文本。
 */
export function quoteEngineString(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function engineValueText(value: string | number | boolean): string {
  return typeof value === "string" ? quoteEngineString(value) : String(value);
}

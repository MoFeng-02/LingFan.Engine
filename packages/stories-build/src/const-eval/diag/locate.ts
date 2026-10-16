/**
 * 诊断定位：在入口源里定位 `export <key>` 的 1 基 line/col。
 */
import { readFileSync } from "node:fs";

/** 在入口源文件里定位 `export <key>` 声明（1 基 line/col）；找不到退回 1:1。 */
export function locateExport(
  absEntry: string,
  key: string,
): { line: number; col: number } {
  let text: string;
  try {
    text = readFileSync(absEntry, "utf8");
  } catch {
    return { line: 1, col: 1 };
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns =
    key === "default"
      ? [/(^|\n)[ \t]*export[ \t]+default\b/]
      : [
          new RegExp(
            `(^|\\n)[ \\t]*export[ \t]+(?:const|let|var|async[ \t]+function|function|class)[ \t]+${escaped}\\b`,
          ),
          new RegExp(
            `(^|\\n)[ \\t]*export[ \t]*\\{[^}]*\\b${escaped}\\b[^}]*\\}`,
          ),
        ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match !== null) return offsetToPos(text, match.index + match[1].length);
  }
  return { line: 1, col: 1 };
}

export function offsetToPos(
  text: string,
  offset: number,
): { line: number; col: number } {
  const lines = text.slice(0, offset).split("\n");
  return {
    line: lines.length,
    col: (lines[lines.length - 1] ?? "").length + 1,
  };
}

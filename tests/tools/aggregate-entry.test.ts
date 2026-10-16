/**
 * 聚合入口纯度互锁（源级扫描，不跑构建）：包与应用里各级目录出口（`index.ts`）
 * 只负责把同级实现文件的名字转发出去，本身不放实现。实现一旦写进出口，调用方就会
 * 为了拿一个函数而整目录加载，出口也跟着变成第二个实现点——两处同名实现容易各自演化。
 *
 * 扫描面用 import.meta.glob 以 `?raw` 读源码文本，判据前先剥掉注释与字符串字面量
 * （文档注释里出现 `export function` 字样不算实现）。
 */
import { describe, expect, it } from "vitest";

const INDEX_SOURCES = import.meta.glob(
  ["../../packages/*/src/**/index.ts", "../../apps/*/src/**/index.ts"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 允许出现在出口里的语句：纯转发（`export … from`）与公开类型别名 */
const IMPLEMENTATION_PATTERNS: readonly [RegExp, string][] = [
  [/\bexport\s+(async\s+)?function\b/, "export function"],
  [/\bexport\s+class\b/, "export class"],
  [/\bexport\s+(const|let|var)\b/, "export const/let/var"],
  [/^\s*(async\s+)?function\s+[$A-Za-z_]/m, "顶层 function 声明"],
  [/^\s*(const|let|var)\s+[$A-Za-z_]/m, "顶层变量声明"],
];

/** 剥掉行/块注释与字符串字面量，只留代码骨架（避免文档注释误报） */
function stripToCodeSkeleton(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\n\s*\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** 出口里出现的第一条实现语句（无则返回 null） */
function firstImplementation(source: string): string | null {
  const skeleton = stripToCodeSkeleton(source);
  for (const [pattern, label] of IMPLEMENTATION_PATTERNS) {
    if (pattern.test(skeleton)) return label;
  }
  return null;
}

describe("聚合入口纯度（源级扫描）", () => {
  const entries = Object.entries(INDEX_SOURCES);

  it("扫描面自检：命中全部包与应用出口（glob 失配时立刻失败）", () => {
    expect(entries.length).toBeGreaterThanOrEqual(90);
    const keys = Object.keys(INDEX_SOURCES);
    for (const known of [
      "../../packages/adapters/src/host/index.ts",
      "../../packages/adapters/src/index.ts",
      "../../packages/shell/src/events/index.ts",
      "../../packages/shell/src/notices/index.ts",
      "../../packages/shell/src/state/index.ts",
    ]) {
      expect(keys, `扫描面缺 ${known}`).toContain(known);
    }
  });

  it("判据自检：实现语句判红、纯转发与类型别名判绿、注释里的字样不误报", () => {
    expect(firstImplementation("export function f(): void {}")).toBe(
      "export function",
    );
    expect(firstImplementation("export class C {}")).toBe("export class");
    expect(firstImplementation("export const X = 1;")).toBe(
      "export const/let/var",
    );
    expect(firstImplementation("function helper(): void {}")).toBe(
      "顶层 function 声明",
    );
    expect(firstImplementation("const seq = 0;")).toBe("顶层变量声明");
    expect(firstImplementation('export { f } from "./f";')).toBeNull();
    expect(firstImplementation('export type { T } from "./types";')).toBeNull();
    expect(
      firstImplementation(
        '/**\n * 原来这里是 export function f\n */\nexport * from "./f";',
      ),
    ).toBeNull();
  });

  it("目录出口只做转发：任何 index.ts 内不得出现实现", () => {
    const offenders = entries
      .map(([key, raw]) => ({ key, found: firstImplementation(raw) }))
      .filter((entry) => entry.found !== null);
    expect(
      offenders.map((entry) => `${entry.key} [${entry.found}]`),
      "聚合入口出现实现（应下沉到同级实现文件）",
    ).toEqual([]);
  });
});

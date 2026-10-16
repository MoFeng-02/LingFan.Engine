/**
 * 注释纪律互锁（§9，源级扫描，不跑构建）：禁止「分组计数」式注释——形如
 * `// 文本（4）`、`// 进度族 5`。
 *
 * 为什么需要这条：这类注释里的数字必须随分组增删手工同步，漏改一行就变成错信息；
 * §9 的「准确、清洁、有效」三条硬标准明确禁止把会随时间失效的数字写进源码注释。
 * 分组名本身可以留（读者需要知道分了哪几族），数字不留。
 */
import { describe, expect, it } from "vitest";

const SRC = import.meta.glob(
  [
    "../../packages/*/src/**/*.ts",
    "../../packages/*/src/**/*.vue",
    "../../apps/*/src/**/*.ts",
    "../../apps/*/src/**/*.vue",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** 命中「分组计数」注释的行（判据本体，便于自证） */
function countedComments(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), no: index + 1 }))
    .filter(({ text }) => /^\/\/.*(?:（\d+）|族\s+\d+)\s*$/.test(text))
    .map(({ text, no }) => `${no}: ${text}`);
}

describe("注释纪律（§9 分组计数注释）", () => {
  it("扫描面自检：命中源码文件（glob 失配时立刻失败）", () => {
    expect(Object.keys(SRC).length).toBeGreaterThanOrEqual(100);
  });

  it("判据自证：计数注释判红，纯分组名判绿", () => {
    expect(countedComments("// 文本（4）")).toEqual(["1: // 文本（4）"]);
    expect(countedComments("// 进度族 5")).toEqual(["1: // 进度族 5"]);
    expect(countedComments("// 文本\n// 进度 / 滑块 / 选择")).toEqual([]);
  });

  it("全仓无分组计数注释", () => {
    const offenders = Object.entries(SRC)
      .map(([key, source]) => {
        const hits = countedComments(source);
        return hits.length === 0
          ? null
          : `${key.replace(/^(\.\.\/)+/, "")} —— 行 ${hits
              .map((hit) => hit.split(":")[0])
              .join(",")}`;
      })
      .filter((item): item is string => item !== null);
    expect(offenders, "分组计数注释的数字会失效：去掉计数，只留分组名").toEqual(
      [],
    );
  });
});

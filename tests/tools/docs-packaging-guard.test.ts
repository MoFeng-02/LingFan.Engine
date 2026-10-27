/**
 * 公开站点不写打包实现细节：词表与文档内容双侧互锁。
 *
 * 为什么需要这条判据：公开站只讲「资源可以是密文」这一层契约（`reference/manifest.md`
 * 的 `resourceEncryption` 字段、`concepts/encryption.md` 的三层分工），**不讲怎么产出
 * 密文包**——工具名、构建开关名、密钥引导文件、加密原语名词都不出现。这条口径原本只
 * 靠人工 grep 一次性验收，换人换时间就会漂移，所以在此固化成可重复执行的判据。
 *
 * 两侧都锁：
 * - 词表侧：`docs/scripts/audit-redline/checks-leech.ts` 必须把每个词收进「打包实现细节」
 *   一类，且该类必须落在严格 0 命中组（`STRICT_NAMES`），而不是「命中后人工复核」组；
 * - 内容侧：`docs/src/content/docs` 全库（含 en）对这些词必须 0 命中。
 *
 * 只改一侧会失败，这是有意的：想让某个词合法出现在站点上，得同时改两侧并说明理由，
 * 而不是悄悄把它从词表里删掉。
 */
import { describe, expect, it } from "vitest";
import leechSource from "../../docs/scripts/audit-redline/checks-leech.ts?raw";

/** 打包实现细节的完整词表（判据侧声明，实现侧必须逐一覆盖） */
const PACKAGING_TOKENS = [
  "lfenpack",
  "LFEN_ENCRYPTED_BUILD",
  "LFEN2",
  "LFS3",
  "__key__",
  "prepare-dist",
  "dist-enc",
  "密钥派生",
  "AAD",
  "魔数",
];

const DOCS = import.meta.glob("../../docs/src/content/docs/**/*.{md,mdx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 文档里已出现过的普通尺寸说法，不算打包细节 */
function docsHits(token: string): string[] {
  const hits: string[] = [];
  for (const [path, body] of Object.entries(DOCS)) {
    const needle =
      token === "AAD" ? /\bAAD\b/ : new RegExp(escapeRe(token), "g");
    if (needle.test(body)) hits.push(`${path} ← ${token}`);
  }
  return hits;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("公开站点不写打包实现细节", () => {
  it("扫描面非空：文档语料真的被读进来了", () => {
    expect(Object.keys(DOCS).length).toBeGreaterThan(20);
    const zh = Object.keys(DOCS).filter((p) => !p.includes("/docs/en/"));
    expect(zh.length).toBeGreaterThan(20);
  });

  it("词表侧：每个词都在「打包实现细节」这条正则里", () => {
    const line = leechSource.split("\n").find((l) => l.includes("lfenpack|"));
    expect(line, "找不到打包实现细节的正则行").toBeDefined();
    for (const token of PACKAGING_TOKENS) {
      expect(line, `正则缺少 ${token}`).toContain(token);
    }
  });

  it("词表侧：该类落在严格 0 命中组，不走人工复核", () => {
    const strictBlock = leechSource.slice(
      leechSource.indexOf("const STRICT_NAMES"),
      leechSource.indexOf("]", leechSource.indexOf("const STRICT_NAMES")),
    );
    expect(strictBlock).toContain("打包实现细节");
    // 反向设防：严格组判定读的是 STRICT_NAMES，不能再写回硬编码的旧三元组
    expect(leechSource).not.toContain(
      'n === "私有文档引用" || n === "内部规约文件"',
    );
  });

  it("内容侧：文档全库对这些词 0 命中", () => {
    const hits = PACKAGING_TOKENS.flatMap(docsHits);
    expect(hits, `文档里出现了打包实现细节：\n${hits.join("\n")}`).toEqual([]);
  });
});

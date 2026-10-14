/**
 * 集中文案表注入（texts）与编译期求值超时注入口（evalTimeoutMs）契约测试。
 *
 * 三类断言：
 *   ① 缺省路径：不传 texts，构建失败信息即构建层的既有文案（不传 texts 行为不变）；
 *   ② 注入路径：传 Partial 文案（哨兵串）⇒ 构建失败信息取注入值；
 *   ③ evalTimeoutMs 注入：config.ts 顶层自旋挂起 + 1ms 时限 ⇒ 超时诊断。
 *
 * fixture 沿 build-pipeline.test.ts 的 makeProject 模式（本文件独立 BASE 下自建工程）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories, type StoriesBuildTexts } from "@lingfan/stories-build";

/**
 * 独立 BASE（仓内约定：每测试文件一个 .tmp-* 目录）。不共用 build-pipeline 的
 * .tmp-build/——其 afterEach 全量 rmSync(BASE) 会删掉并行运行中的别家 fixture
 * （vitest 文件级并行默认开启），导致本文件构建中途 "Could not resolve" 假失败。
 */
const BASE = fileURLToPath(new URL("./.tmp-texts/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

function makeProject(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** config.ts 布局声明（与 build-pipeline.test.ts 同款）。 */
const config = (folders: string[], start = "start.ts"): string =>
  `export const folders = ${JSON.stringify(folders)};\nexport const start = ${JSON.stringify(start)};\n`;

/** 工程清单。 */
const MANIFEST = `{
  "formatVersion": 1,
  "name": "演示工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

/** 词汇层绑定（与 build-pipeline.test.ts 同款）。 */
const WORDS = `import { script } from "@lingfan/editor";
const { say, option, menu, guard, cell, extOp } = script;

`;

/** v2 故事源范式：default 导出的具名 function = 一个故事 = 一个列 id（= 函数名）。 */
const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {
${body}
}
`;

/** 列体顶层 return 的最小触发源。 */
const TOP_RETURN_STORY = story("start", `  say("前");\n  return;\n`);

describe("stories-build 文案表注入（texts）与 evalTimeoutMs", () => {
  it("①缺省路径：E10 顶层 return 文案即既有文案（不传 texts 行为不变）", async () => {
    const root = makeProject("texts-default-e10", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": TOP_RETURN_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /列体顶层不能 return（E10）：return 只能在函数体内/,
    );
  });

  it("②注入哨兵：自定义 topLevelReturn ⇒ 构建失败信息取注入值（缺省串不再出现）", async () => {
    const SENTINEL = "顶层 return 哨兵文案（注入生效）";
    const texts: Partial<StoriesBuildTexts> = { topLevelReturn: () => SENTINEL };
    const root = makeProject("texts-inject-e10", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": TOP_RETURN_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root, { texts })).rejects.toThrow(SENTINEL);
    await expect(buildStories(root, { texts })).rejects.not.toThrow(
      /列体顶层不能 return/,
    );
  });

  it("③注入哨兵：E06 列 id 大小写重复 ⇒ columnIdDuplicate 取注入值（插值参数照传）", async () => {
    const texts: Partial<StoriesBuildTexts> = {
      columnIdDuplicate: (id, prev) => `列 id 冲突哨兵（E06）: ${id} vs ${prev}`,
    };
    const root = makeProject("texts-inject-e06", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": story("Start", `  say("一");`),
      "Stories.src/ch1/second.ts": story("start", `  say("二");`),
      "Resources/project.json": MANIFEST,
    });
    // prev 实参 = 对侧文件相对路径（checkColumnIds 以 sourceRelPath 记 seen）
    await expect(buildStories(root, { texts })).rejects.toThrow(
      /列 id 冲突哨兵（E06）: [Ss]tart vs ch1\/(start|second)\.ts/,
    );
  });

  it("④evalTimeoutMs：config.ts 顶层自旋 + 1ms 时限 ⇒ 超时诊断（fail-closed）", async () => {
    const root = makeProject("texts-eval-timeout", {
      "Stories.src/config.ts":
        `${config(["ch1"])}const spinStart = Date.now();\n` +
        `while (Date.now() - spinStart < 5_000) {}\n` +
        `export const after = 1;\n`,
      "Stories.src/ch1/start.ts": story("start", `  say("你好");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root, { evalTimeoutMs: 1 })).rejects.toThrow(
      /编译期求值超时（>1ms）/,
    );
    // worker 被强杀后 esbuild 子进程可能仍短暂握着 fixture 目录的句柄：
    // 稍候再进 afterEach 清理，避免 Windows 下 rmSync EPERM 偶发。
    await new Promise((r) => setTimeout(r, 50));
  });

  it("⑤fail-closed：文案注入的失败路径零写盘（不产 Stories/ 产物）", async () => {
    const texts: Partial<StoriesBuildTexts> = {
      topLevelReturn: () => "哨兵文案",
    };
    const root = makeProject("texts-fail-closed", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": TOP_RETURN_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root, { texts })).rejects.toThrow("哨兵文案");
    expect(existsSync(join(root, "Resources/Stories"))).toBe(false);
  });
});

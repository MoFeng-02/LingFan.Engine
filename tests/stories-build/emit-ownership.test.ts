/**
 * 产物归属契约：构建只删自己上一轮写过的文件。
 *
 * 契约口径：
 * - 删除的唯一依据是产物账（工程根 `.lingfan/stories-build.json`，内容 = 上一轮写进
 *   资源根的 `Stories/**` 逻辑路径，按码元序）。作者手写的 `.story` / JSON 列文件从不
 *   进账，因此构建不碰它们；
 * - 账缺失（首次运行 / 刚升级）时一轮不删——旧版本没有账，无法区分「上轮我写的」与
 *   「作者手写的」，宁可不删；
 * - 账的内容幂等：同样产物集重复构建不重写文件。
 *
 * fixture 全部自建在本文件的独立 BASE（tests/stories-build/.tmp-ownership/，vite fs.allow 白名单内）。
 * 不共用 build-pipeline.test.ts 的 .tmp-build/：其 afterEach 全量删 BASE，而 vitest 按文件并行，
 * 会删掉本文件运行中的 fixture，表现为构建中途 "Could not resolve" 假失败。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-ownership/", import.meta.url));
const LEDGER_REL = ".lingfan/stories-build.json";

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

/** config.ts 布局声明（源侧根文件：folders 多目录 + start 入口文件名）。 */
const config = (folders: string[], start = "start.ts"): string =>
  `export const folders = ${JSON.stringify(folders)};\nexport const start = ${JSON.stringify(start)};\n`;

const MANIFEST = `{
  "formatVersion": 1,
  "name": "演示工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

/** 词汇层绑定（script 命名空间解构；与真实工程一致）。 */
const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {
${body}
}
`;

const SYNTHETIC_STORY = story("start", `  say("欢迎来到灵泛");`);

/** 手写列文件：`.story` 文本形态与 JSON v1 形态各一份，列 id 都不与 TS 源冲突。 */
const HANDWRITTEN_STORY = `# handwritten
:: handwritten_start
手写的开场白。
`;
const HANDWRITTEN_JSON = `{
  "formatVersion": 1,
  "id": "manual",
  "kind": "flow",
  "commands": [{ "op": "say", "text": "手写的 JSON 列" }]
}`;

function ledgerOf(root: string): { products: string[] } {
  return JSON.parse(readFileSync(join(root, LEDGER_REL), "utf8")) as {
    products: string[];
  };
}

describe("产物账 · 作者手写文件不被构建删除", () => {
  it("手写 .story 与手写 JSON 列文件连续两次构建后仍在盘上", async () => {
    const root = makeProject("own-handwritten", {
      "src/Stories.src/config.ts": config(["common"]),
      "src/Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
      "Resources/Stories/handwritten.story": HANDWRITTEN_STORY,
      "Resources/Stories/manual.json": HANDWRITTEN_JSON,
    });
    const first = await buildStories(root);
    expect(first.removed).toEqual([]);
    expect(existsSync(join(root, "Resources/Stories/handwritten.story"))).toBe(
      true,
    );
    expect(existsSync(join(root, "Resources/Stories/manual.json"))).toBe(true);

    const second = await buildStories(root);
    expect(second.removed).toEqual([]);
    expect(existsSync(join(root, "Resources/Stories/handwritten.story"))).toBe(
      true,
    );
    expect(existsSync(join(root, "Resources/Stories/manual.json"))).toBe(true);
    // 手写文件从不出现在账里：账只记本工具写出的路径
    expect(ledgerOf(root).products).toEqual(["Stories/common/start.json"]);
  });

  it("账缺失时一轮不删：既有手写文件与既有旧产物都保留，只写账", async () => {
    const root = makeProject("own-no-ledger", {
      "src/Stories.src/config.ts": config(["common"]),
      "src/Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
      "Resources/Stories/handwritten.story": HANDWRITTEN_STORY,
      "Resources/Stories/legacy.json": HANDWRITTEN_JSON,
    });
    expect(existsSync(join(root, LEDGER_REL))).toBe(false);
    const report = await buildStories(root);
    expect(report.removed).toEqual([]);
    expect(existsSync(join(root, "Resources/Stories/handwritten.story"))).toBe(
      true,
    );
    expect(existsSync(join(root, "Resources/Stories/legacy.json"))).toBe(true);
    expect(ledgerOf(root).products).toEqual(["Stories/common/start.json"]);
  });

  it("反向证伪：手写路径一旦进了账，就被当作本工具产物清理", async () => {
    const root = makeProject("own-ledger-deletes", {
      "src/Stories.src/config.ts": config(["common"]),
      "src/Stories.src/common/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
      "Resources/Stories/manual.json": HANDWRITTEN_JSON,
    });
    // 伪造「上一轮它是我写的」：账里登记手写路径，本轮产物集里没有 ⇒ 删除
    mkdirSync(join(root, ".lingfan"), { recursive: true });
    writeFileSync(
      join(root, LEDGER_REL),
      `${JSON.stringify({ products: ["Stories/manual.json"] }, null, 2)}\n`,
    );
    const report = await buildStories(root);
    expect(report.removed).toEqual(["Stories/manual.json"]);
    expect(existsSync(join(root, "Resources/Stories/manual.json"))).toBe(false);
  });
});

describe("产物账 · 陈旧产物清理与账本身", () => {
  it("源故事删除后其编译产物被清理（陈旧清理没被破坏）", async () => {
    const root = makeProject("own-stale", {
      "src/Stories.src/config.ts": config(["common"]),
      "src/Stories.src/common/start.ts": SYNTHETIC_STORY,
      "src/Stories.src/common/tavern.ts": story("tavern", `  say("到了酒馆");`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(existsSync(join(root, "Resources/Stories/common/tavern.json"))).toBe(
      true,
    );

    rmSync(join(root, "src/Stories.src/common/tavern.ts"), { force: true });
    const report = await buildStories(root);
    expect(report.removed).toEqual(["Stories/common/tavern.json"]);
    expect(existsSync(join(root, "Resources/Stories/common/tavern.json"))).toBe(
      false,
    );
    expect(ledgerOf(root).products).toEqual(["Stories/common/start.json"]);
  });

  it("账按码元序、只记资源根内的 Stories 产物，且重复构建不重写（幂等）", async () => {
    const root = makeProject("own-ledger-order", {
      "src/Stories.src/config.ts": config(["zeta", "alpha"]),
      "src/Stories.src/zeta/zeta_main.ts": story("zeta_main", `  say("Z");`),
      "src/Stories.src/alpha/start.ts": SYNTHETIC_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const ledgerPath = join(root, LEDGER_REL);
    const text = readFileSync(ledgerPath, "utf8");
    const products = (JSON.parse(text) as { products: string[] }).products;
    expect(products).toEqual([
      "Stories/alpha/start.json",
      "Stories/zeta/zeta_main.json",
    ]);
    expect(text.endsWith("\n")).toBe(true);

    const stamp = statSync(ledgerPath).mtimeMs;
    await buildStories(root);
    expect(readFileSync(ledgerPath, "utf8")).toBe(text);
    expect(statSync(ledgerPath).mtimeMs).toBe(stamp);
  });
});

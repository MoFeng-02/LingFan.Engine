/**
 * 列类型声明（columnType）契约测试。
 *
 * 契约口径：故事文件模块顶层 `export const columnType = "ui"` 声明本列类型，与 JSON 形态的
 * `type` 字段同义；显式写 `"game"` 与不写等价，产物一律不带 `type` 键（与序列化口径一致，
 * 同源必须同产物）；非契约取值 fail-closed 且诊断带 源文件:行:列；只有故事文件可声明。
 *
 * 全部走公共入口 buildStories（白盒为零）；产物以 Resources/Stories 列 JSON 为证。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-column-type/", import.meta.url));

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

const config = (folders: string[], start = "start.ts"): string =>
  `export const folders = ${JSON.stringify(folders)};\nexport const start = ${JSON.stringify(start)};\n`;

const MANIFEST = `{
  "formatVersion": 1,
  "name": "列类型工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START = "src/Stories.src/ch1/start.ts";
const STORY_JSON = "Resources/Stories/ch1/start.json";

describe("列类型 · 构建期", () => {
  it("ui 列级声明落产物：列对象带 type", async () => {
    const root = makeProject("ui-column-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnType = "ui";\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    const column = JSON.parse(readFileSync(join(root, STORY_JSON), "utf8"));
    expect(column.type).toBe("ui");
  });

  it("显式 game 与不写等价：产物都不带 type 键", async () => {
    const explicit = makeProject("explicit-game-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnType = "game";\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(explicit);
    const explicitText = readFileSync(join(explicit, STORY_JSON), "utf8");
    expect(explicitText).not.toContain('"type"');

    const silent = makeProject("silent-game-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好");\n`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(silent);
    const silentText = readFileSync(join(silent, STORY_JSON), "utf8");
    expect(silentText).toBe(explicitText);
  });

  it("非契约取值 fail-closed：诊断带 源文件:行:列", async () => {
    const root = makeProject("bad-column-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnType = "menu";\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*columnType 必须折叠为 "game" 或 "ui" 字面量/,
    );
  });

  it("columnType 只能声明在故事文件：模块文件声明 = 诊断", async () => {
    const root = makeProject("module-column-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      "src/Stories.src/ch1/theme.ts": `export const columnType = "ui";\n`,
      [START]: story("start", `  say("你好");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /columnType 只能声明在故事文件/,
    );
  });

  it("columnType 走既有 const 折叠通道：其他 const 可折叠，非字符串标量拒", async () => {
    const computed = makeProject("computed-column-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `const KIND = "ui";\nexport const columnType = KIND;\n\n${story(
        "start",
        `  say("你好");\n`,
      )}`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(computed);
    const column = JSON.parse(readFileSync(join(computed, STORY_JSON), "utf8"));
    expect(column.type).toBe("ui");

    const numeric = makeProject("numeric-column-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnType = 42;\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(numeric)).rejects.toThrow(
      /columnType 必须折叠为 "game" 或 "ui" 字面量/,
    );
  });

  it("无声明零打扰：产物不带 type 键，与 font/uis 并存互不影响", async () => {
    const root = makeProject("no-column-type", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好");\n`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readFileSync(join(root, STORY_JSON), "utf8")).not.toContain(
      '"type"',
    );
  });
});

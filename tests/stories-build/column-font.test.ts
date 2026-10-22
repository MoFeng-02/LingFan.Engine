/**
 * 列级字体声明（columnFont）契约测试。
 *
 * 契约口径：故事文件模块顶层 `export const columnFont = "<字体名>"` 声明本列排版字体；
 * 值走既有 const 折叠通道（字面量/常量运算同源），构建期对照字体名注册表 fail-closed
 * （未注册名诊断带 源文件:行:列）；只有故事文件（default 导出列）可声明；
 * 无声明 = 产物不带 font 键（零打扰）。
 *
 * 全部走公共入口 buildStories（白盒为零）；产物以 Resources/Stories 列 JSON 为证。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-column-font/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

function makeProject(
  name: string,
  files: Record<string, string>,
  fontFiles: string[] = [],
): string {
  const root = join(BASE, name);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  for (const file of fontFiles) {
    const path = join(root, "Resources/Fonts", file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "stub");
  }
  return root;
}

const config = (folders: string[], start = "start.ts"): string =>
  `export const folders = ${JSON.stringify(folders)};\nexport const start = ${JSON.stringify(start)};\n`;

const MANIFEST = `{
  "formatVersion": 1,
  "name": "列级字体工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START = "Stories.src/ch1/start.ts";
const STORY_JSON = "Resources/Stories/ch1/start.json";

describe("列级字体 · 构建期", () => {
  it("注册字体的列级声明落产物：列对象带 font，与 say 行参并存", async () => {
    const root = makeProject(
      "registered-column-font",
      {
        "Stories.src/config.ts": config(["ch1"]),
        [START]: `export const columnFont = "楷体";\n\n${story(
          "start",
          `  say("你好", { font: "黑体" });\n`,
        )}`,
        "Resources/project.json": MANIFEST,
      },
      ["楷体.ttf", "黑体.ttf"],
    );
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    const column = JSON.parse(readFileSync(join(root, STORY_JSON), "utf8"));
    expect(column.font).toBe("楷体");
    expect(JSON.stringify(column)).toContain('"font":"黑体"'); // say 行参不受影响（列 JSON 为紧凑序列化）
  });

  it("未注册的列级字体 fail-closed：诊断带 源文件:行:列", async () => {
    const root = makeProject("unregistered-column-font", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnFont = "宋体";\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*未注册的字体名 "宋体"/,
    );
  });

  it("columnFont 只能声明在故事文件：模块文件声明 = 诊断", async () => {
    const root = makeProject(
      "module-column-font",
      {
        "Stories.src/config.ts": config(["ch1"]),
        "Stories.src/ch1/theme.ts": `export const columnFont = "楷体";\n`,
        [START]: story("start", `  say("你好");\n`),
        "Resources/project.json": MANIFEST,
      },
      ["楷体.ttf"],
    );
    await expect(buildStories(root)).rejects.toThrow(
      /columnFont 只能声明在故事文件/,
    );
  });

  it("columnFont 非字符串字面量 fail-closed（数值/空串都拒）", async () => {
    const numeric = makeProject("numeric-column-font", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnFont = 42;\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(numeric)).rejects.toThrow(
      /columnFont 必须折叠为非空字符串字面量/,
    );
    const empty = makeProject("empty-column-font", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnFont = "";\n\n${story("start", `  say("你好");\n`)}`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(empty)).rejects.toThrow(
      /columnFont 必须折叠为非空字符串字面量/,
    );
  });

  it("无声明零打扰：产物不带 font 键", async () => {
    const root = makeProject("no-column-font", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好");\n`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readFileSync(join(root, STORY_JSON), "utf8")).not.toContain(
      '"font"',
    );
  });
});

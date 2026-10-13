/**
 * 字体名注册表契约测试（界面规范「字体资产链」）。
 *
 * 契约口径：Resources/Fonts 字体文件名去扩展名 = 合法字体名；构建期对静态引用
 * fail-closed（{font=} 行内标签 + say 行参 font 两处可达面，未注册名一次报全部，
 * 落点带 源文件:行:列）；模板插值与标识符实参降糖成 `{…}` 包裹形态 = 动态值，
 * 编译期放行（运行期档负责）；无 Fonts 目录 = 空注册表，引用即报、不引用零打扰。
 *
 * 全部走公共入口 buildStories（白盒为零）；产物以 Resources/Stories 列 JSON 为证。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-fonts/", import.meta.url));

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
  "name": "字体注册表工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START = "Stories.src/ch1/start.ts";
const STORY_JSON = "Resources/Stories/ch1/start.json";

function readStoryText(root: string): string {
  return readFileSync(join(root, STORY_JSON), "utf8");
}

describe("字体名注册表 · 构建期 fail-closed", () => {
  it("注册字体的静态引用通过：say 行参 font 与 {font=} 标签照常落产物", async () => {
    const root = makeProject(
      "registered-pass",
      {
        "Stories.src/config.ts": config(["ch1"]),
        [START]: story(
          "start",
          `  say("你好", { font: "楷体" });\n  say("{font=楷体}强调{/font}正文");\n`,
        ),
        "Resources/project.json": MANIFEST,
      },
      ["楷体.ttf"],
    );
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    const text = readStoryText(root);
    expect(text).toContain('"font": "楷体"');
    expect(text).toContain("强调");
  });

  it("未注册的 say 行参 font fail-closed：诊断带 源文件:行:列", async () => {
    const root = makeProject("unregistered-font-field", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好", { font: "宋体" });\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*未注册的字体名 "宋体"/,
    );
  });

  it("未注册的 {font=} 标签一次报全部（一个文本里两个未注册名 = 两条诊断）", async () => {
    const root = makeProject("unregistered-tags", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story(
        "start",
        `  say("{font=宋体}甲{/font}{font=黑体}乙{/font}");\n`,
      ),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未注册的字体名 "宋体"/);
    await expect(buildStories(root)).rejects.toThrow(/未注册的字体名 "黑体"/);
  });

  it("动态值编译期放行：插值降糖形态（{…} 包裹）不对照注册表", async () => {
    const root = makeProject("dynamic-pass", {
      "Stories.src/config.ts": config(["ch1"]) + `define("player.skin", "楷体");\n`,
      [START]:
        story("start", [
          `  say("你好", { font: state.player.skin });`,
          `  say(\`你好 {font=\${state.player.skin}}欢迎\`);`,
        ].join("\n")),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
  });

  it("空注册表（无 Fonts 目录）同样 fail-closed：引用即报", async () => {
    const root = makeProject("no-fonts-dir", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好", { font: "楷体" });\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未注册的字体名 "楷体"/);
  });

  it("无字体引用且无 Fonts 目录 = 零打扰：正常构建", async () => {
    const root = makeProject("no-fonts-no-refs", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好");\n`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readStoryText(root)).not.toContain('"font"');
  });

  it("非字体扩展名不注册：仅 .ttf/.otf/.woff/.woff2 计入", async () => {
    const root = makeProject(
      "ext-filter",
      {
        "Stories.src/config.ts": config(["ch1"]),
        [START]: story("start", `  say("你好", { font: "楷体" });\n`),
        "Resources/project.json": MANIFEST,
      },
      ["楷体.txt"],
    );
    await expect(buildStories(root)).rejects.toThrow(/未注册的字体名 "楷体"/);
  });
});

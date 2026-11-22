/**
 * 字体名注册表契约测试。
 *
 * 契约口径：Resources/Fonts 字体文件名去扩展名 = 合法字体名，字体可按分类分目录存放
 * （子目录逐层下探，`file` 为相对字体根的路径）；构建期对静态引用
 * fail-closed（{font=} 行内标签 + say 行参 font 两处可达面，未注册名一次报全部，
 * 落点带 源文件:行:列）；模板插值与标识符实参降糖成 `{…}` 包裹形态 = 动态值，
 * 编译期放行（运行期档负责）；无 Fonts 目录 = 空注册表，引用即报、不引用零打扰。
 *
 * 全部走公共入口 buildStories（白盒为零）；产物以 Resources/Stories 列 JSON 为证。
 * 扫描器自身的 `file` 路径口径（相对字体根、`/` 分隔、码元序排序、点文件跳过）是宿主
 * 拼资源 URL 的直接输入，另立白盒块钉住。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";
import { scanFontRegistry } from "../../packages/stories-build/src/fonts/font-registry.ts";
import { renderFontTypegen } from "../../packages/stories-build/src/typegen/font-render.ts";

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

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START = "src/Stories.src/ch1/start.ts";
const STORY_JSON = "Resources/Stories/ch1/start.json";

function readStoryText(root: string): string {
  return readFileSync(join(root, STORY_JSON), "utf8");
}

describe("字体名注册表 · 构建期 fail-closed", () => {
  it("注册字体的静态引用通过：say 行参 font 与 {font=} 标签照常落产物", async () => {
    const root = makeProject(
      "registered-pass",
      {
        "src/Stories.src/config.ts": config(["ch1"]),
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
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好", { font: "宋体" });\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*未注册的字体名 "宋体"/,
    );
  });

  it("未注册的 {font=} 标签一次报全部（一个文本里两个未注册名 = 两条诊断）", async () => {
    const root = makeProject("unregistered-tags", {
      "src/Stories.src/config.ts": config(["ch1"]),
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
      "src/Stories.src/config.ts":
        config(["ch1"]) + `define("player.skin", "楷体");\n`,
      [START]: story(
        "start",
        [
          `  say("你好", { font: state.player.skin });`,
          `  say(\`你好 {font=\${state.player.skin}}欢迎\`);`,
        ].join("\n"),
      ),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
  });

  it("空注册表（无 Fonts 目录）同样 fail-closed：引用即报", async () => {
    const root = makeProject("no-fonts-dir", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: story("start", `  say("你好", { font: "楷体" });\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未注册的字体名 "楷体"/);
  });

  it("无字体引用且无 Fonts 目录 = 零打扰：正常构建", async () => {
    const root = makeProject("no-fonts-no-refs", {
      "src/Stories.src/config.ts": config(["ch1"]),
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
        "src/Stories.src/config.ts": config(["ch1"]),
        [START]: story("start", `  say("你好", { font: "楷体" });\n`),
        "Resources/project.json": MANIFEST,
      },
      ["楷体.txt"],
    );
    await expect(buildStories(root)).rejects.toThrow(/未注册的字体名 "楷体"/);
  });
});

describe("字体名注册表 · 递归扫描（子目录分类）", () => {
  const SCAN_BASE = fileURLToPath(
    new URL("./.tmp-font-scan/", import.meta.url),
  );

  afterEach(() => {
    rmSync(SCAN_BASE, { recursive: true, force: true });
  });

  /** 在临时根下铺一棵字体树，返回字体根路径 */
  function makeFontTree(files: string[]): string {
    const fontsDir = join(SCAN_BASE, "Fonts");
    for (const rel of files) {
      const path = join(fontsDir, rel);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "stub");
    }
    return fontsDir;
  }

  it("子目录逐层下探：file = 相对字体根的路径（/ 分隔），多层子目录同样登记", () => {
    const entries = scanFontRegistry(
      makeFontTree([
        "楷体.ttf",
        "private_fonts/OTF/楷体.otf",
        "private_fonts/WOFF2/OTF/子集/楷体.otf.woff2",
      ]),
    );
    expect(entries.map((entry) => entry.file)).toEqual([
      "private_fonts/OTF/楷体.otf",
      "private_fonts/WOFF2/OTF/子集/楷体.otf.woff2",
      "楷体.ttf",
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      "楷体",
      "楷体.otf",
      "楷体",
    ]);
  });

  it("同族不同格式同名共存：一个字体名可由多条 file 提供（宿主按格式择优）", () => {
    const entries = scanFontRegistry(
      makeFontTree([
        "private_fonts/OTF/宋体.otf",
        "private_fonts/TTF/宋体.ttf",
      ]),
    );
    expect(entries.map((entry) => entry.file)).toEqual([
      "private_fonts/OTF/宋体.otf",
      "private_fonts/TTF/宋体.ttf",
    ]);
    expect(entries.map((entry) => entry.name)).toEqual(["宋体", "宋体"]);
  });

  it("点文件与点目录整族跳过：不入注册表", () => {
    const entries = scanFontRegistry(
      makeFontTree([
        ".DS_Store",
        ".hidden.ttf",
        "private_fonts/.hidden/宋体.ttf",
        "宋体.ttf",
      ]),
    );
    expect(entries.map((entry) => entry.file)).toEqual(["宋体.ttf"]);
  });

  it("非字体扩展名与无扩展名不登记：仅 .ttf/.otf/.woff/.woff2 计入", () => {
    const entries = scanFontRegistry(
      makeFontTree(["宋体.txt", "宋体.ttc", "宋体", "宋体.woff2"]),
    );
    expect(entries.map((entry) => entry.file)).toEqual(["宋体.woff2"]);
  });

  it("字体根缺失 = 空注册表（合法，等价未声明任何字体）", () => {
    expect(scanFontRegistry(join(SCAN_BASE, "不存在的字体根"))).toEqual([]);
  });

  it("构建期同样认子目录字体：静态引用子目录内的字体名通过", async () => {
    const root = makeProject(
      "nested-font-pass",
      {
        "src/Stories.src/config.ts": config(["ch1"]),
        [START]: story("start", `  say("你好", { font: "楷体" });\n`),
        "Resources/project.json": MANIFEST,
      },
      ["private_fonts/OTF/楷体.otf"],
    );
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readStoryText(root)).toContain('"font": "楷体"');
  });
});

describe("字体类型面渲染 · 按字体名去重", () => {
  it("同族多格式同名共存：类型面每个字体名只出现一次", () => {
    const output = renderFontTypegen([
      { file: "private_fonts/OTF/宋体.otf", name: "宋体" },
      { file: "private_fonts/TTF/宋体.ttf", name: "宋体" },
      { file: "private_fonts/OTF/楷体.otf", name: "楷体" },
    ]);
    const keys = output.match(/readonly "[^"]+":/g) ?? [];
    expect(keys).toEqual(['readonly "宋体":', 'readonly "楷体":']);
  });

  it("空注册表仍是封闭空类型（键访问改拼必报错）", () => {
    expect(renderFontTypegen([])).toContain(
      "declare const font: Record<never, never>;",
    );
  });
});

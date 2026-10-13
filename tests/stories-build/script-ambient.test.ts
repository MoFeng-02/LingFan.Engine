/**
 * script 命名空间 ambient 直呼契约测试（免导入 `script.bgm(...)`）。
 *
 * 契约口径：作者不写 `import { script }` 也能 `script.bgm(...)` 直呼——编译器在
 * 无绑定且接收者恰为标识符 `script` 时按词表解析属性名（gen/script.gen.d.ts 的
 * 全局声明供 tsc/IDE 用，纯类型面零运行时注入）；显式 import / 解构 / 重命名
 * 路径全保留且产物与 ambient 形态等值；模块层自有同名声明按 TS 遮蔽语义优先，
 * 不按词解析；未知词 fail-closed 且文案指路两条调用形态；模块层词调用语句仍拒。
 *
 * 全部走公共入口 buildStories（白盒为零）；判别以故事产物 JSON 逐字节等值与
 * 诊断文案为证。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-script-ambient/", import.meta.url));

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
  "name": "script ambient 工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const START = "Stories.src/ch1/start.ts";
const SCRIPT_GEN = "Stories.src/gen/script.gen.d.ts";

const AMBIENT_BODY = `  script.bgm("loop.ogg");
  script.wait(30);
  script.menu("下一站？", [script.option("A", "b")]);`;

const DESTRUCTURE_BODY = `  bgm("loop.ogg");
  wait(30);
  menu("下一站？", [option("A", "b")]);`;

const story = (head: string, body: string): string =>
  `${head}\nexport default function start(): void {\n${body}\n}\n`;

const AMBIENT_STORY = story("", AMBIENT_BODY);
const DESTRUCTURE_STORY = story(
  `import { script } from "@lingfan/editor";\nconst { bgm, wait, menu, option } = script;\n`,
  DESTRUCTURE_BODY,
);

function readStoryJson(root: string): string {
  return readFileSync(join(root, "Resources/Stories/ch1/start.json"), "utf8");
}

describe("script 命名空间 ambient 直呼", () => {
  it("免导入 script.* 直呼：编译成功且与解构形态产物逐字节等值", async () => {
    const ambientRoot = makeProject("ambient-eq", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: AMBIENT_STORY,
      "Resources/project.json": MANIFEST,
    });
    const destructureRoot = makeProject("destructure-eq", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: DESTRUCTURE_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(ambientRoot);
    await buildStories(destructureRoot);
    expect(readStoryJson(ambientRoot)).toBe(readStoryJson(destructureRoot));
    // ambient 声明文件随之落盘，tsc/IDE 侧才有 script 的类型可引
    const genText = readFileSync(join(ambientRoot, SCRIPT_GEN), "utf8");
    expect(genText).toContain(
      'declare const script: typeof import("@lingfan/editor").script;',
    );
  });

  it("模块函数体内同样直呼：词函数体经 ambient 解析（缺兜底会报方法调用不支持）", async () => {
    const root = makeProject("module-fn", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/lib/sfx.ts": `export function ping(): void {\n  script.bgm("x.ogg");\n}\n`,
      [START]: `import { ping } from "../lib/sfx";\n\nexport default function start(): void {\n  ping();\n}\n`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).resolves.toBeTruthy();
    const storyJson = JSON.parse(readStoryJson(root)) as {
      functions?: Array<{ body?: unknown }>;
    };
    expect(JSON.stringify(storyJson)).toContain("bgm");
  });

  it("未知词 fail-closed：文案指路 script 命名空间与具名导入", async () => {
    const root = makeProject("unknown-word", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story("", `  script.nope("x");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /词汇层不存在词 `nope`——词函数经 `script\.` 命名空间或具名导入调用/,
    );
  });

  it("模块内自有声明遮蔽 ambient：不按词解析（fail-closed）", async () => {
    const root = makeProject("shadowed", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: `function script(): void {}\n\n${story("", `  script.bgm("x");`)}`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/方法调用不支持/);
  });

  it("别名导入不受影响：import { script as st } 后 st.bgm 与具名导入产物等值", async () => {
    const aliasRoot = makeProject("alias-eq", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story(
        `import { script as st } from "@lingfan/editor";\n`,
        `  st.bgm("loop.ogg");`,
      ),
      "Resources/project.json": MANIFEST,
    });
    const namedRoot = makeProject("named-eq", {
      "Stories.src/config.ts": config(["ch1"]),
      [START]: story(
        `import { bgm } from "@lingfan/editor";\n`,
        `  bgm("loop.ogg");`,
      ),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(aliasRoot);
    await buildStories(namedRoot);
    expect(readStoryJson(aliasRoot)).toBe(readStoryJson(namedRoot));
  });

  it("模块层词调用语句仍 fail-closed：白名单不含词调用", async () => {
    const root = makeProject("module-layer-word", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/extra.ts": `script.bgm("x.ogg");\n`,
      [START]: story("", `  script.bgm("loop.ogg");`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/模块层不支持此语句/);
  });
});

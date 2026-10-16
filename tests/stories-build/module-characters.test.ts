/**
 * 模块层构建期角色声明（character）契约测试。
 *
 * 契约：Stories.src 任意 .ts 模块顶层的 character(key, spec) 调用收为全工程
 * 角色表，编译时按 key 字典序前置进每个故事列头（先于函数 func 命令）；列内
 * character 同键命令沿用运行期覆盖语义，收集层不合并；同名不同义 fail-closed
 * 一次报两处声明位置，全等声明幂等；白名单六字段（name/color/size/font/textColor/
 * screen）之外的字段拒绝；key 必须非空字符串字面量；函数体内 character 是运行期
 * 词，收集器不碰。
 *
 * 全部走公共入口 buildStories（白盒为零）；角色表以产物列头命令序列为证。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(
  new URL("./.tmp-module-characters/", import.meta.url),
);

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
  "name": "模块层角色工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan/editor";
const { say, wait, character } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START = "Stories.src/ch1/start.ts";

interface SerializedCommand {
  op: string;
  key?: string;
  [field: string]: unknown;
}

function readCommands(root: string, rel: string): SerializedCommand[] {
  const storyFile = JSON.parse(
    readFileSync(join(root, "Resources/Stories", rel), "utf8"),
  ) as { commands: SerializedCommand[] };
  return storyFile.commands ?? [];
}

describe("模块层构建期角色 · 收集与前置", () => {
  it("模块顶层 character 前置进列头：六字段全投影，先于 say", async () => {
    const root = makeProject("prefixed", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/roles.ts": `character("主角", {\n  name: "旅人",\n  color: "#123456",\n  size: "28px",\n});\n`,
      [START]: story("start", `  say("你好。", "主角");\n  wait(0.01);\n`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const commands = readCommands(root, "ch1/start.json");
    expect(commands[0]).toMatchObject({
      op: "character",
      key: "主角",
      name: "旅人",
      color: "#123456",
      size: "28px",
    });
    expect(commands[1]?.op).toBe("say");
  });

  it("跨文件多角色按 key 字典序前置；列内同键 character 沿用覆盖语义不合并", async () => {
    const root = makeProject("multi-sorted", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/roles.ts":
        `character("乙", { name: "乙名" });\n` +
        `character("甲", { name: "甲名" });\n`,
      [START]: story(
        "start",
        `  character("甲", { color: "#ABCDEF" });\n  say("覆盖后。", "甲");\n`,
      ),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const commands = readCommands(root, "ch1/start.json");
    expect(commands.map((c) => c.op)).toEqual([
      "character",
      "character",
      "character",
      "say",
    ]);
    expect(commands[0]).toMatchObject({ key: "甲", name: "甲名" });
    expect(commands[1]).toMatchObject({ key: "乙", name: "乙名" });
    expect(commands[2]).toMatchObject({
      op: "character",
      key: "甲",
      color: "#ABCDEF",
    });
  });

  it("全等声明幂等：两处一致不报冲突", async () => {
    const root = makeProject("idempotent", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `character("同", { name: "同名" });\n`,
      "Stories.src/ch1/b.ts": `character("同", { name: "同名" });\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).resolves.toBeDefined();
  });
});

describe("模块层构建期角色 · fail-closed", () => {
  it("同名不同义：一次报两处声明位置", async () => {
    const root = makeProject("conflict", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `character("冲突", { name: "A" });\n`,
      "Stories.src/ch1/b.ts": `character("冲突", { name: "B" });\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    // 报文以首个声明处（ch1/a.ts）为参照、冲突处（ch1/b.ts）为主语，两处位置齐全
    //（formatOrigin 自带尾随空格，"处"前是双空格，断言按 `\s+` 容纳）
    await expect(buildStories(root)).rejects.toThrow(
      /b\.ts:1:1 角色 "冲突" 与 ch1\/a\.ts:1:1\s+处的声明冲突（同名不同义）/,
    );
  });

  it("未知字段拒绝并提示白名单", async () => {
    const root = makeProject("unknown-field", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `character("探针", { name: "x", 非法: "1" });\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/未知字段 "非法"/);
  });

  it("key 非字符串字面量拒绝", async () => {
    const root = makeProject("bad-key", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `const k = "动态";\ncharacter(k, { name: "x" });\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /首参必须是非空字符串字面量 key/,
    );
  });

  it("遮蔽（本地声明 character 标识符）拒绝", async () => {
    const root = makeProject("shadowed", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `import { script } from "@lingfan/editor";\nconst { character } = script;\nfunction local(): void {}\ncharacter("键", { name: "x" });\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/遮蔽/);
  });

  it("非字符串 spec 值拒绝", async () => {
    const root = makeProject("bad-spec", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `character("探针", { name: 42 });\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/字段 name/);
  });
});

describe("模块层构建期角色 · 运行期边界", () => {
  it("函数体内 character 是运行期词：收集器不收，构建照常通过", async () => {
    const root = makeProject("runtime-character", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/a.ts": `export function seed(): void {\n  character("幽灵", { name: "幽灵" });\n}\n`,
      [START]: story("start", `  say("ok");\n`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const commands = readCommands(root, "ch1/start.json");
    expect(commands.some((c) => c.op === "character" && c.key === "幽灵")).toBe(
      false,
    );
  });
});

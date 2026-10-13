/**
 * 模块层构建期 define 契约测试（设计稿 §二 define 域放宽）。
 *
 * 契约口径：config.ts + Stories.src 任意 .ts 模块顶层（函数体外）的 define 调用
 * 汇入同一棵合并树（defines/state.gen.d.ts/插值键同源）；跨文件同键与形状冲突
 * fail-closed 一次报全部（落点带 源文件:行:列）；config 形态 A（state 导出）与
 * 模块层 define 互斥；vars（defineVars）保持 config.ts 独占；函数体内 define 是
 * 运行期词，收集器不碰；值域 = 字面量/数组/对象/枚举成员引用，枚举标识符按各模块
 * 的 import 回收为 state.gen 的 import type。
 *
 * 全部走公共入口 buildStories（白盒为零）；defines 以产物 project.json 为证，
 * 类型面以 state.gen.d.ts 逐字节/包含断言为证。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-module-define/", import.meta.url));

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
  "name": "模块层 define 工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START = "Stories.src/ch1/start.ts";

function readDefines(root: string): Record<string, unknown> {
  const project = JSON.parse(
    readFileSync(join(root, "Resources/project.json"), "utf8"),
  ) as { defines?: Record<string, unknown> };
  return project.defines ?? {};
}

function readStateGen(root: string): string {
  return readFileSync(join(root, "Stories.src/gen/state.gen.d.ts"), "utf8");
}

const ENUMS_LIB =
  `export enum Sex {\n  Male = "male",\n  Female = "female",\n}\n` +
  `export enum Lv {\n  One,\n  Two,\n}\n`;

describe("模块层构建期 define · 收集与合并", () => {
  it("config 与模块顶层 define 汇入同一棵树：defines 与 state.gen 同源等值", async () => {
    const root = makeProject("merge-equal", {
      "Stories.src/config.ts":
        config(["ch1"]) + `define("player.gold", 100);\n`,
      "Stories.src/ch1/state.ts":
        `define("player.name", { type: "string", default: "旅人" });\n` +
        `define("extra.hp", 5);\n`,
      [START]: story("start", `  say("金币 {player.gold} 血量 {extra.hp}");\n`),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readDefines(root)).toEqual({
      "player.gold": 100,
      "player.name": "旅人",
      "extra.hp": 5,
    });
    expect(readStateGen(root)).toContain(`"player": {`);
    expect(readStateGen(root)).toContain(`"extra": {`);
  });

  it("spec 对象实参在模块层同样合法：单参 define 折叠为子树", async () => {
    const root = makeProject("spec-form", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/state.ts":
        `define({ one: 1, nested: { deep: "v" } });\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(readDefines(root)).toEqual({ one: 1, "nested.deep": "v" });
    expect(readStateGen(root)).toContain(`"deep": string;`);
  });

  it("枚举跨模块回收：模块 import 的 enum 生成 import type，数字枚举自增求值", async () => {
    const root = makeProject("enum-across", {
      "Stories.src/lib/enums.ts": ENUMS_LIB,
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/state.ts":
        `import { Sex, Lv } from "../lib/enums";\n` +
        `define("player.sex", { type: Sex, default: Sex.Male });\n` +
        `define("player.lv", { type: Lv, default: Lv.Two });\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(readDefines(root)).toEqual({ "player.sex": "male", "player.lv": 1 });
    const gen = readStateGen(root);
    expect(gen).toContain(`import type { Lv, Sex } from "../lib/enums";`);
    expect(gen).toContain(`"sex": Sex;`);
    expect(gen).toContain(`"lv": Lv;`);
  });
});

describe("模块层构建期 define · fail-closed", () => {
  it("跨文件同键定义一次报全部：冲突文案带 config 与两处模块落点", async () => {
    const root = makeProject("cross-conflict", {
      "Stories.src/config.ts":
        config(["ch1"]) + `define("player.gold", 100);\n`,
      "Stories.src/ch1/a.ts": `define("player.gold", 1);\n`,
      "Stories.src/ch1/b.ts": `define("player.gold", 2);\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /模块层构建期 define 冲突（2 条）[\s\S]*defines\["player.gold"\]：同键二次定义[\s\S]*config\.ts 与 ch1\/a\.ts:1:1[\s\S]*config\.ts 与 ch1\/b\.ts:1:1/,
    );
    expect(existsSync(join(root, "Stories.src/gen/state.gen.d.ts"))).toBe(false);
  });

  it("形态 A（state 导出）与模块层 define 互斥：报互斥文案与模块落点", async () => {
    const root = makeProject("form-a-exclusive", {
      "Stories.src/config.ts":
        config(["ch1"]) +
        `export const state = { player: { gold: 100 } } as const;\n`,
      "Stories.src/ch1/state.ts": `define("extra.hp", 5);\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /形态 A（state 导出）与模块层构建期 define 互斥[\s\S]*ch1\/state\.ts:1:1 define\("extra\.hp"\)/,
    );
  });

  it("vars 保持 config 独占：模块顶层 defineVars 仍被模块层白名单拒绝", async () => {
    const root = makeProject("vars-exclusive", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/state.ts": `defineVars({ foo: "number" });\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /模块层不支持此语句：只允许 const\/函数\/enum\/导入\/类型声明\/default 导出与构建期 define/,
    );
    expect(existsSync(join(root, "Stories.src/gen/state.gen.d.ts"))).toBe(false);
  });

  it("值域收窄：函数体等不可序列化值 fail-closed 且不落任何生成物", async () => {
    const root = makeProject("non-serializable", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/state.ts": `define("a.b", () => 1);\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /模块层构建期 define 收集失败（1 条）[\s\S]*ch1\/state\.ts:1:1 define\("a\.b"\)：值必须是可序列化常量/,
    );
    expect(existsSync(join(root, "Stories.src/gen/state.gen.d.ts"))).toBe(false);
    expect(existsSync(join(root, "Stories.src/gen/stories.gen.d.ts"))).toBe(false);
  });

  it("path 形首参必须是字符串字面量", async () => {
    const root = makeProject("bad-first-arg", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/state.ts": `define(42, 1);\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/state\.ts:1:1 define 首参必须是字符串字面量路径，或单参对象实参/,
    );
  });

  it("白名单不放宽：非 define 的顶层表达式语句仍被模块层拒绝", async () => {
    const root = makeProject("other-expr", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/state.ts": `foo();\n`,
      [START]: story("start", `  say("hello");\n`),
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/模块层不支持此语句/);
  });
});

describe("模块层构建期 define · 运行期边界", () => {
  it("函数体内的 define 是运行期词：收集器不收，构建照常通过", async () => {
    const root = makeProject("runtime-define", {
      "Stories.src/config.ts":
        config(["ch1"]) + `define("player.gold", 100);\n`,
      "Stories.src/ch1/state.ts":
        `export function seed(): void {\n  define("ghost.key", 1);\n}\n`,
      [START]: story("start", `  say("金币 {player.gold}");\n`),
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const defines = readDefines(root);
    expect(defines).toHaveProperty("player.gold", 100);
    expect(defines).not.toHaveProperty("ghost.key");
    expect(readStateGen(root)).not.toContain(`"ghost"`);
  });
});

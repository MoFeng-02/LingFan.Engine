/**
 * config.ts 契约测试（config 化换道后的声明通道）。
 *
 * 契约口径：
 * `src/Stories.src/config.ts` 两种声明形态等价，单次求值一并取出，双形态混用 fail-closed：
 *   - default 对象（推荐）：export default { folders, start, version?, vars?, state? }
 *     —— 强类型单出口（StoriesConfig 全局类型补全）；
 *   - named exports：export const folders/start/version/vars/state（兼容既有工程）。
 * 并叠加形态 B 的 define() 累积（与两种 config 形态正交）：
 *   - 布局字段复用 parseFolders/parseStart 校验（fail-closed）；
 *   - 形态 A（state 声明）与形态 B（define 调用）二选一，混用报错，皆缺省合法；
 *   - define 累积：点路径与对象实参混用，求值毕合并为纯嵌套树，同键二次定义/形状
 *     冲突一次报全部（不后写覆盖）；点路径空段拒；对象字面量点键留给降维段守卫；
 *   - state/define 合并树与形态 A 走同一降维文法（descriptor/enum/数组 descriptor/
 *     type 槽并集——多元素数组成员槽位，null 为成员之一）。
 *
 * 五类覆盖（测试分层约定）：①拟态用户（四导出全链/default 形态全链/枚举相对导入求值）
 * ②故意错误（混用/互斥/冲突/空段/点键/值文法）③不变量（define 合并树只经降维进 defines）
 * ④边界（皆缺省）⑤回归（defines 逐键落 project.json）。
 *
 * 白盒为零：全部走公共入口 buildStories，公共 API 走 @lingfan-engine/*。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-config-state/", import.meta.url));

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
  "name": "config 契约工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const story = (name: string, body: string): string =>
  `${WORDS}export default function ${name}(): void {\n${body}\n}\n`;

const START_STORY = story("start", `  say("hello");\n`);

function readDefines(root: string): Record<string, unknown> {
  const project = JSON.parse(
    readFileSync(join(root, "Resources/project.json"), "utf8"),
  ) as { defines?: Record<string, unknown> };
  return project.defines ?? {};
}

function readTypegen(root: string): string {
  return readFileSync(join(root, "src/gen/stories.gen.d.ts"), "utf8");
}

describe("config.ts 契约 · 四导出求值（拟态用户）", () => {
  it("folders/start/vars/state 全链：state 与 vars 键分别落 defines 与插值注册表", async () => {
    const root = makeProject("four-exports", {
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `export const vars = defineVars({ "bag.size": "num" });\n` +
        `export const state = { player: { gold: 100 } } as const;\n`,
      "src/Stories.src/ch1/start.ts": story(
        "start",
        `  state.player.gold += 20;\n  say("金币 {player.gold}，背包 {bag.size}");\n`,
      ),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);

    // state 导出经降维成为 defines（player.gold=100，初始值）；故事里的 `+= 20` 是
    // 运行期 set op（产物命令流），不动构建期 defines——两件事各归各位。
    expect(readDefines(root)).toMatchObject({ "player.gold": 100 });
    // vars 键进插值注册表（typegen defineKeys 源）。
    expect(readTypegen(root)).toContain('"bag.size": 1;');
  });

  it(" Sex 枚举相对导入求值：descriptor 枚举 type/default 走同一降维文法（任务点④）", async () => {
    const root = makeProject("sex-enum", {
      "src/Stories.src/lib/sex.ts": `export enum Sex {\n  Male = "male",\n  Female = "female",\n}\n`,
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `import { Sex } from "./lib/sex";\n` +
        `export const state = {\n  player: { sex: { type: Sex, default: Sex.Male } },\n} as const;\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    // 枚举对象作为 descriptor 的 type（asEnumValues 值域 male/female），default 命中值域。
    expect(readDefines(root)).toMatchObject({ "player.sex": "male" });
  });
});

describe("config.ts 契约 · 形态 B（define 累积）", () => {
  it("点路径与对象实参混用：合并树经同一降维文法落 defines", async () => {
    const root = makeProject("define-mixed", {
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `define("player.gold", 100);\n` +
        `define({ dice: { type: "number", default: 1 } });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(readDefines(root)).toMatchObject({ "player.gold": 100, dice: 1 });
  });

  it("同键二次定义与形状冲突 ⇒ 一次报全部（fail-closed，不后写覆盖）", async () => {
    const root = makeProject("define-conflicts", {
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `define("a.b", 1);\n` +
        `define("a.b", 2);\n` +
        `define("c", 1);\n` +
        `define({ c: { d: 2 } });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/define 声明冲突（2 条）/);
    await expect(buildStories(root)).rejects.toThrow(
      /defines\["a\.b"\]：同键二次定义/,
    );
    await expect(buildStories(root)).rejects.toThrow(
      /defines\["c"\]：形状冲突——叶值与分支对象不能同键/,
    );
  });

  it("点路径含空段 ⇒ 拒（a..b、.a、a. 形态一律 fail-closed）", async () => {
    const root = makeProject("define-empty-segment", {
      "src/Stories.src/config.ts": config(["ch1"]) + `define("a..b", 1);\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/点路径含空段/);
  });

  it("对象字面量点键不拦在合并层 ⇒ 降维段 dotKeyError 统一守卫", async () => {
    const root = makeProject("define-dotted-key", {
      "src/Stories.src/config.ts": config(["ch1"]) + `define({ "a.b": 1 });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/点路径键不支持/);
  });

  it("define 值不可序列化 ⇒ 拒（值文法与 state 同规）", async () => {
    const root = makeProject("define-bad-value", {
      "src/Stories.src/config.ts": config(["ch1"]) + `define("a", () => 1);\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/define\("a"\)/);
    await expect(buildStories(root)).rejects.toThrow(/不可序列化|函数/);
  });
});

describe("config.ts 契约 · 形态互斥与缺省（fail-closed / 边界）", () => {
  it("state 导出与 define() 并存 ⇒ 形态 A/B 二选一（同文件混用即报错）", async () => {
    const root = makeProject("ab-mutual", {
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `export const state = { player: { gold: 100 } } as const;\n` +
        `define("dice", 1);\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/形态 A\/B 二选一/);
  });

  it("皆缺省：只有 folders/start 也构建绿（空 schema 贡献合法）", async () => {
    const root = makeProject("bare-config", {
      "src/Stories.src/config.ts": config(["ch1"]),
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readDefines(root)).toEqual({});
  });

  it("缺少必需导出（folders）⇒ fail-closed 并说明契约", async () => {
    const root = makeProject("missing-folders", {
      "src/Stories.src/config.ts": `export const start = "start.ts";\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/缺少 folders 导出/);
    await expect(buildStories(root)).rejects.toThrow(
      /default 对象或 folders\/start named exports 二选一/,
    );
  });

  it("state 导出不是键集对象 ⇒ fail-closed（形态 A 值文法）", async () => {
    const root = makeProject("bad-state-shape", {
      "src/Stories.src/config.ts":
        config(["ch1"]) + `export const state = [1, 2];\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/state 须为键集对象/);
  });
});

describe("config.ts 契约 · default 对象形态（强类型单出口）", () => {
  it("default 全链：folders/start/vars/state 与 named exports 等值落 defines 与插值注册表", async () => {
    const root = makeProject("default-form", {
      "src/Stories.src/config.ts":
        `export default {\n` +
        `  folders: ["ch1"],\n` +
        `  start: "start.ts",\n` +
        `  vars: defineVars({ "bag.size": "num" }),\n` +
        `  state: { player: { gold: 100 } } as const,\n` +
        `} satisfies StoriesConfig;\n`,
      "src/Stories.src/ch1/start.ts": story(
        "start",
        `  state.player.gold += 20;\n  say("金币 {player.gold}，背包 {bag.size}");\n`,
      ),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readDefines(root)).toMatchObject({ "player.gold": 100 });
    expect(readTypegen(root)).toContain('"bag.size": 1;');
  });

  it("default + define() 累积正交：形态 B 与 default 对象并存", async () => {
    const root = makeProject("default-with-define", {
      "src/Stories.src/config.ts":
        `export default {\n` +
        `  folders: ["ch1"],\n` +
        `  start: "start.ts",\n` +
        `};\n` +
        `define("player.gold", 100);\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readDefines(root)).toMatchObject({ "player.gold": 100 });
  });

  it("default 缺 folders ⇒ fail-closed 并说明契约", async () => {
    const root = makeProject("default-missing-folders", {
      "src/Stories.src/config.ts": `export default { start: "start.ts" };\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /default 配置缺少 folders 字段/,
    );
  });

  it("default 不是对象 ⇒ fail-closed", async () => {
    const root = makeProject("default-not-object", {
      "src/Stories.src/config.ts": `export default "main.ts";\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /default 导出须为配置对象/,
    );
  });

  it("default 与 named exports 混用 ⇒ fail-closed（二选一）", async () => {
    const root = makeProject("mixed-forms", {
      "src/Stories.src/config.ts":
        `export default { folders: ["ch1"], start: "start.ts" };\n` +
        `export const vars = defineVars({ extra: "num" });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /default 对象与 named exports（folders\/start\/version\/vars\/state）混用/,
    );
  });
});

describe("config.ts 契约 · type 槽并集文法（成员槽位取并集，null 入值域）", () => {
  const SEX_LIB = `export enum Sex {\n  Male = "male",\n  Female = "female",\n}\n`;

  it("多元素数组 type 槽位 = 并集：default 落在成员值域内即合法（null 空值初值）", async () => {
    const root = makeProject("union-legal", {
      "src/Stories.src/lib/sex.ts": SEX_LIB,
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `import { Sex } from "./lib/sex";\n` +
        `define("hp", { type: ["number", Sex, null], default: null });\n` +
        `define("mood", { type: ["string", Sex], default: Sex.Female });\n` +
        `define("tags", { type: [["number", "string"]], default: [] });\n` +
        `define("team", { type: [Sex], default: [] });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(readDefines(root)).toMatchObject({
      hp: null,
      mood: "female",
      tags: [],
    });
  });

  it("形态 A 同文法：as const 元组并集 + null default 走同一降维", async () => {
    const root = makeProject("union-form-a", {
      "src/Stories.src/lib/sex.ts": SEX_LIB,
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `import { Sex } from "./lib/sex";\n` +
        `export const state = {\n  medal: { type: ["string", Sex, null] as const, default: null },\n} as const;\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(readDefines(root)).toMatchObject({ medal: null });
  });

  it("default 不在任何成员值域内 ⇒ fail-closed", async () => {
    const root = makeProject("union-bad-default", {
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `define("hp", { type: ["number", "string"], default: true });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /descriptor default 不在并集值域内/,
    );
  });

  it("未知并集成员 ⇒ 一次报全部（fail-closed）", async () => {
    const root = makeProject("union-bad-member", {
      "src/Stories.src/config.ts":
        config(["ch1"]) +
        `define("hp", { type: ["number", true, { a: "x", b: null }, null], default: null });\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/并集第 2 个成员无法识别/);
    await expect(buildStories(root)).rejects.toThrow(/并集第 3 个成员无法识别/);
    // 第 4 个成员是合法 null，不在报错之列。
    await expect(buildStories(root)).rejects.not.toThrow(/并集第 4 个成员/);
  });
});

describe("config.ts 契约 · 回归", () => {
  it("state 降维诊断挂在 config.ts 定位（STATE_SCHEMA_REL 硬编码已退役）", async () => {
    // 裸数组拒（降维文法）+ 定位锚定：诊断文件必须是 config.ts，而不是旧 lib/state.ts。
    const root = makeProject("diag-location", {
      "src/Stories.src/config.ts":
        config(["ch1"]) + `export const state = { bag: ["sword"] };\n`,
      "src/Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/数组值请用 descriptor/);
    await expect(buildStories(root)).rejects.toThrow(/config\.ts:1:1/);
    await expect(buildStories(root)).rejects.not.toThrow(/lib\/state\.ts/);
    // fail-closed：不产类型面文件。
    expect(existsSync(join(root, "src/gen/stories.gen.d.ts"))).toBe(false);
    expect(existsSync(join(root, "src/gen/state.gen.d.ts"))).toBe(false);
  });
});

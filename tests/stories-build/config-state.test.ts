/**
 * config.ts 契约测试（config 化换道后的声明通道）。
 *
 * 契约口径（界面规范：项目记录 对应章节/对应章节）：
 * `Stories.src/config.ts` 以 named exports 单次求值声明四导出——folders/start（布局，必需）、
 * vars/state（可缺省），并叠加形态 B 的 define() 累积：
 *   - 布局字段复用 parseFolders/parseStart 校验（fail-closed）；
 *   - 形态 A（state 导出）与形态 B（define 调用）二选一，混用报错，皆缺省合法；
 *   - define 累积：点路径与对象实参混用，求值毕合并为纯嵌套树，同键二次定义/形状
 *     冲突一次报全部（不后写覆盖）；点路径空段拒；对象字面量点键留给降维段守卫；
 *   - state/define 合并树与形态 A 走同一降维文法（descriptor/enum/数组 descriptor）。
 *
 * 五类覆盖（内部规约 对应章节 测试纪律）：①拟态用户（四导出全链/枚举相对导入求值）
 * ②故意错误（互斥/冲突/空段/点键/值文法）③不变量（define 合并树只经降维进 defines）
 * ④边界（皆缺省）⑤回归锚定（defines 逐键落 project.json）。
 *
 * 白盒为零：全部走公共入口 buildStories（内部规约 公共 API 走 @lingfan/*）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan/stories-build";

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

const WORDS = `import { script } from "@lingfan/editor";
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
  return readFileSync(
    join(root, "Stories.src/gen/stories.gen.d.ts"),
    "utf8",
  );
}

describe("config.ts 契约 · 四导出求值（拟态用户）", () => {
  it("folders/start/vars/state 全链：state 与 vars 键分别落 defines 与插值注册表", async () => {
    const root = makeProject("four-exports", {
      "Stories.src/config.ts":
        config(["ch1"]) +
        `export const vars = defineVars({ "bag.size": "num" });\n` +
        `export const state = { player: { gold: 100 } } as const;\n`,
      "Stories.src/ch1/start.ts": story(
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
      "Stories.src/lib/sex.ts": `export enum Sex {\n  Male = "male",\n  Female = "female",\n}\n`,
      "Stories.src/config.ts":
        config(["ch1"]) +
        `import { Sex } from "./lib/sex";\n` +
        `export const state = {\n  player: { sex: { type: Sex, default: Sex.Male } },\n} as const;\n`,
      "Stories.src/ch1/start.ts": START_STORY,
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
      "Stories.src/config.ts":
        config(["ch1"]) +
        `define("player.gold", 100);\n` +
        `define({ dice: { type: "number", default: 1 } });\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect(readDefines(root)).toMatchObject({ "player.gold": 100, dice: 1 });
  });

  it("同键二次定义与形状冲突 ⇒ 一次报全部（fail-closed，不后写覆盖）", async () => {
    const root = makeProject("define-conflicts", {
      "Stories.src/config.ts":
        config(["ch1"]) +
        `define("a.b", 1);\n` +
        `define("a.b", 2);\n` +
        `define("c", 1);\n` +
        `define({ c: { d: 2 } });\n`,
      "Stories.src/ch1/start.ts": START_STORY,
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
      "Stories.src/config.ts": config(["ch1"]) + `define("a..b", 1);\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/点路径含空段/);
  });

  it("对象字面量点键不拦在合并层 ⇒ 降维段 dotKeyError 统一守卫（对应章节.3/对应章节.6）", async () => {
    const root = makeProject("define-dotted-key", {
      "Stories.src/config.ts": config(["ch1"]) + `define({ "a.b": 1 });\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/点路径键不支持/);
  });

  it("define 值不可序列化 ⇒ 拒（值文法与 state 同规）", async () => {
    const root = makeProject("define-bad-value", {
      "Stories.src/config.ts": config(["ch1"]) + `define("a", () => 1);\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/define\("a"\)/);
    await expect(buildStories(root)).rejects.toThrow(/不可序列化|函数/);
  });
});

describe("config.ts 契约 · 形态互斥与缺省（fail-closed / 边界）", () => {
  it("state 导出与 define() 并存 ⇒ 形态 A/B 二选一（同文件混用即报错）", async () => {
    const root = makeProject("ab-mutual", {
      "Stories.src/config.ts":
        config(["ch1"]) +
        `export const state = { player: { gold: 100 } } as const;\n` +
        `define("dice", 1);\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/形态 A\/B 二选一/);
  });

  it("皆缺省：只有 folders/start 也构建绿（空 schema 贡献合法）", async () => {
    const root = makeProject("bare-config", {
      "Stories.src/config.ts": config(["ch1"]),
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(readDefines(root)).toEqual({});
  });

  it("缺少必需导出（folders）⇒ fail-closed 并说明契约", async () => {
    const root = makeProject("missing-folders", {
      "Stories.src/config.ts": `export const start = "start.ts";\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/缺少 folders 导出/);
    await expect(buildStories(root)).rejects.toThrow(
      /folders\/start 必需，vars\/state 可缺省/,
    );
  });

  it("state 导出不是键集对象 ⇒ fail-closed（形态 A 值文法）", async () => {
    const root = makeProject("bad-state-shape", {
      "Stories.src/config.ts": config(["ch1"]) + `export const state = [1, 2];\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/state 导出须为键集对象/);
  });
});

describe("config.ts 契约 · 回归锚定", () => {
  it("state 降维诊断挂在 config.ts 定位（STATE_SCHEMA_REL 硬编码已退役）", async () => {
    // 裸数组拒（降维文法）+ 定位锚定：诊断文件必须是 config.ts，而不是旧 lib/state.ts。
    const root = makeProject("diag-location", {
      "Stories.src/config.ts":
        config(["ch1"]) + `export const state = { bag: ["sword"] };\n`,
      "Stories.src/ch1/start.ts": START_STORY,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(/数组值请用 descriptor/);
    await expect(buildStories(root)).rejects.toThrow(/config\.ts:1:1/);
    await expect(buildStories(root)).rejects.not.toThrow(/lib\/state\.ts/);
    // fail-closed：不产类型面文件。
    expect(existsSync(join(root, "Stories.src/gen/stories.gen.d.ts"))).toBe(
      false,
    );
  });
});

/**
 * label 列：`jump("X")` / `navigate("X")` 指向 `export function X` 时按需产列。
 *
 * 起点是一个不顺手的地方：`jump` 的形参类型是 `KnownColumnName`，而列名注册表只装
 * 真列（`export default` 的故事函数）。作者把一段可跳转的流程写成 `export function X`
 * 时，`jump("X")` 在类型期就红——可 `X` 明明有完整函数体，只是没人给它列位。
 *
 * 解法不是放宽 `jump` 的类型（那会让所有拼写错误静默通过，只在运行期报
 * `unknown-column`），而是反过来：既然有人跳它，就给它一个列。名字真进
 * `ColumnNameRegistry`，拼错仍然是类型错误。
 *
 * 三条判据，各有对应的失败姿势：
 * - **列优先**：`X` 已是 `export default` 列就不再产一条（否则同名列两份、列名冲突）；
 * - **只认字符串字面量**：`jump(someVar)` 静态不可判定，不收（与既有 `emitJump` 的
 *   约束一致，也让「引用才产列」是可判定的）；
 * - **引用才产列**：没被引用的 `export function` 仍是纯模块（`lib/cast.ts` 那种
 *   「函数库，不产生故事列」的语义不能破）。
 *
 * 产出的列与手写的 flow 列同形：`kind:"flow"`，`commands` = 函数体。这样 `jump` 过去
 * 能逐句回退（`call` 到 func 不能——func 帧没有列 id）。
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-label-column/", import.meta.url));

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

const CONFIG =
  'export const folders = ["ch1"];\nexport const start = "start.ts";\n';

const MANIFEST = `{
  "formatVersion": 1,
  "name": "label 列工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { jump, navigate, say, set } = script;

`;

const START = "src/Stories.src/ch1/start.ts";
const TYPEGEN = "src/gen/stories.gen.d.ts";

/** 一个最小工程：`start.ts` 内容由调用方给 */
function project(
  name: string,
  startText: string,
  extra: Record<string, string> = {},
): string {
  return makeProject(name, {
    "src/Stories.src/config.ts": CONFIG,
    [START]: startText,
    "Resources/project.json": MANIFEST,
    ...extra,
  });
}

/**
 * 读产物：把 `Resources/Stories` 下所有列 JSON 归一成 id → 列对象。
 *
 * 必须全扫而不是只读入口那份：label 列写回**函数所在的源文件**对应的那份产物
 * （跨模块引用时不是 `ch1/start.json`），这与列名到文件名的既有映射一致。
 */
function columnsOf(root: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        walk(path);
        continue;
      }
      if (!item.name.endsWith(".json")) continue;
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        columns?: readonly Record<string, unknown>[];
      } & Record<string, unknown>;
      const list = Array.isArray(raw.columns) ? raw.columns : [raw];
      for (const column of list) {
        out.set(String(column.id), column as Record<string, unknown>);
      }
    }
  };
  walk(join(root, "Resources/Stories"));
  return out;
}

/** 列的命令体里出现的 `say` 文案（顺序保持） */
function says(column: Record<string, unknown> | undefined): string[] {
  const commands = column?.commands;
  if (!Array.isArray(commands)) return [];
  return commands
    .filter((cmd) => (cmd as { op?: string }).op === "say")
    .map((cmd) => String((cmd as { text?: unknown }).text));
}

describe("label 列 · 按需产列", () => {
  it('同文件里 `jump("X")` 指向 `export function X` ⇒ 产出一条 flow 列', async () => {
    const root = project(
      "same-file",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("我是被跳过去的那一段");',
        "}",
        "",
        "export default function start(): void {",
        '  say("开场");',
        '  jump("goToLabel");',
        "}",
        "",
      ].join("\n"),
    );
    const report = await buildStories(root);
    expect(report.columns).toBe(2);
    const columns = columnsOf(root);
    const label = columns.get("goToLabel");
    expect(label).toBeDefined();
    expect(label?.kind).toBe("flow");
    expect(says(label)).toEqual(["我是被跳过去的那一段"]);
  });

  it("label 列的命令不混入跳过来的那一列：`start` 只有自己的 say", async () => {
    const root = project(
      "no-bleed",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("标签体");',
        "}",
        "",
        "export default function start(): void {",
        '  say("开场");',
        '  jump("goToLabel");',
        '  say("收场");',
        "}",
        "",
      ].join("\n"),
    );
    await buildStories(root);
    const columns = columnsOf(root);
    // 两列各持自己的命令体：label 体不许渗进 start，反之亦然
    expect(says(columns.get("start"))).toEqual(["开场", "收场"]);
    expect(says(columns.get("goToLabel"))).toEqual(["标签体"]);
  });

  it("label 列的 `entry` 指向自己，产物可被宿主直接进入", async () => {
    const root = project(
      "own-entry",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("标签体");',
        "}",
        "",
        "export default function start(): void {",
        '  jump("goToLabel");',
        "}",
        "",
      ].join("\n"),
    );
    await buildStories(root);
    const label = columnsOf(root).get("goToLabel");
    // 列对象本身是 story，story 的 entry 就是它的 id
    expect(label?.id).toBe("goToLabel");
    expect(label?.kind).toBe("flow");
  });

  it("跨文件：纯模块里的 `export function` 也被收成列（函数库照旧不产列）", async () => {
    const root = project(
      "cross-module",
      [
        WORDS,
        'import { deskTalk } from "./lib/talks.ts";',
        "",
        "export default function start(): void {",
        '  say("开场");',
        '  jump("deskTalk");',
        "  deskTalk();",
        "}",
        "",
      ].join("\n"),
      {
        "src/Stories.src/ch1/lib/talks.ts": [
          WORDS,
          "// 纯模块：没有 default 导出，自己不会产生故事列",
          "export function deskTalk(): void {",
          '  say("桌边的对话");',
          "}",
          "",
        ].join("\n"),
      },
    );
    const report = await buildStories(root);
    // start + deskTalk（后者因为被 jump 引用而产列）
    expect(report.columns).toBe(2);
    expect(says(columnsOf(root).get("deskTalk"))).toEqual(["桌边的对话"]);
  });

  it('`navigate("X")` 同样算引用', async () => {
    const root = project(
      "navigate-ref",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("导航过来");',
        "}",
        "",
        "export default function start(): void {",
        '  navigate("goToLabel");',
        "}",
        "",
      ].join("\n"),
    );
    await buildStories(root);
    expect(says(columnsOf(root).get("goToLabel"))).toEqual(["导航过来"]);
  });

  it('label 列进 `ColumnNameRegistry`：`jump("X")` 在类型期不再红', async () => {
    const root = project(
      "typegen",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("标签体");',
        "}",
        "",
        "export default function start(): void {",
        '  jump("goToLabel");',
        "}",
        "",
      ].join("\n"),
    );
    await buildStories(root);
    const typegen = readFileSync(join(root, TYPEGEN), "utf8");
    // 名字进注册表才是「不放宽 jump 类型」这条设计的落点
    expect(typegen).toContain('"goToLabel": 1;');
    expect(typegen).toContain('"start": 1;');
  });

  it("label 列之间可以互相跳：闭包内的函数也参与引用收集", async () => {
    const root = project(
      "chain",
      [
        WORDS,
        "export function first(): void {",
        '  say("一");',
        '  jump("second");',
        "}",
        "",
        "export function second(): void {",
        '  say("二");',
        '  jump("third");',
        "}",
        "",
        "export function third(): void {",
        '  say("三");',
        "}",
        "",
        "export default function start(): void {",
        '  jump("first");',
        "}",
        "",
      ].join("\n"),
    );
    const report = await buildStories(root);
    // start + first + second + third：链条上每一环都被上一个跳引用
    expect(report.columns).toBe(4);
    const columns = columnsOf(root);
    expect(says(columns.get("second"))).toEqual(["二"]);
  });
});

describe("label 列 · 三条判据", () => {
  it('列优先：`jump("X")` 指向已是 default 导出的列 ⇒ 不额外产列', async () => {
    const root = makeProject("column-priority", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/ch1/start.ts": [
        WORDS,
        'import end from "./end.ts";',
        "",
        "export default function start(): void {",
        '  jump("end");',
        "}",
        "",
      ].join("\n"),
      "src/Stories.src/ch1/end.ts": [
        WORDS,
        "export default function end(): void {",
        '  say("结局");',
        "}",
        "",
      ].join("\n"),
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    // 两列（start + end），end 来自它自己的 default 导出，不是 label 通道
    expect(report.columns).toBe(2);
    expect(says(columnsOf(root).get("end"))).toEqual(["结局"]);
  });

  it("引用才产列：没被跳过的 `export function` 仍是纯模块，不产列", async () => {
    const root = project(
      "unreferenced",
      [
        WORDS,
        'import { farewell } from "./lib/cast.ts";',
        "",
        "export default function start(): void {",
        '  say("开场");',
        "  farewell();",
        "}",
        "",
      ].join("\n"),
      {
        "src/Stories.src/ch1/lib/cast.ts": [
          WORDS,
          "export function farewell(): void {",
          '  say("再见");',
          "}",
          "",
          "export function unusedHelper(): void {",
          '  say("没人找我");',
          "}",
          "",
        ].join("\n"),
      },
    );
    const report = await buildStories(root);
    // 只有 start：没有 jump("farewell")，纯模块不产列
    expect(report.columns).toBe(1);
    const typegen = readFileSync(join(root, TYPEGEN), "utf8");
    expect(typegen).not.toContain('"farewell": 1;');
    expect(typegen).not.toContain('"unusedHelper": 1;');
  });

  it("只认字符串字面量：`jump(someVar)` 不产列，也不吞错误", async () => {
    const root = project(
      "non-literal",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("标签体");',
        "}",
        "",
        "export default function start(): void {",
        '  const target = "goToLabel";',
        "  jump(target);",
        "}",
        "",
      ].join("\n"),
    );
    // 变量实参静态不可判定：既有 `emitJump` 就会拒它，label 通道不扩大可判定的面
    await expect(buildStories(root)).rejects.toThrow(/jump 实参/);
  });
});

describe("label 列 · fail-closed", () => {
  it("目标既不是列也不是函数 ⇒ 构建期报错并指到那一行", async () => {
    const root = project(
      "missing-target",
      [
        WORDS,
        "",
        "export default function start(): void {",
        '  say("开场");',
        '  jump("不存在");',
        "}",
        "",
      ].join("\n"),
    );
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*既不是故事列，也不是任何模块导出的函数/,
    );
  });

  it("目标是函数但没导出 ⇒ 同样是「目标不存在」", async () => {
    const root = project(
      "not-exported",
      [
        WORDS,
        "",
        "function hidden(): void {",
        '  say("藏在里面");',
        "}",
        "",
        "export default function start(): void {",
        '  jump("hidden");',
        "}",
        "",
      ].join("\n"),
    );
    await expect(buildStories(root)).rejects.toThrow(
      /既不是故事列，也不是任何模块导出的函数/,
    );
  });

  it("错误一次性报全：两处不同目标各自一条，不折叠成一条", async () => {
    const root = project(
      "two-missing",
      [
        WORDS,
        "",
        "export default function start(): void {",
        '  jump("甲");',
        '  jump("乙");',
        "}",
        "",
      ].join("\n"),
    );
    await expect(buildStories(root)).rejects.toThrow(/（2 条）/);
  });
});

describe("label 列 · 与列形态正交", () => {
  it("label 列永远是 flow：函数体是命令体，不是组件", async () => {
    const root = project(
      "always-flow",
      [
        WORDS,
        "export function goToLabel(): void {",
        '  say("标签体");',
        "}",
        "",
        "export default function start(): void {",
        '  jump("goToLabel");',
        "}",
        "",
      ].join("\n"),
    );
    await buildStories(root);
    const label = columnsOf(root).get("goToLabel");
    expect(label?.kind).toBe("flow");
    // 不带身体字段：`export function` 里没有 body 声明可捡
    expect(label?.body).toBeUndefined();
    expect(label?.elements).toBeUndefined();
  });

  it('场景列里写 `jump("X")`：entry 里跳，label 列照产', async () => {
    const root = makeProject("scene-jump", {
      "src/Stories.src/config.ts": CONFIG,
      [START]: [
        'import { kitchen } from "../../gen/scene_register.g";',
        'export const columnKind = "scene";',
        "export const body = kitchen;",
        "",
        WORDS,
        "export function goToLabel(): void {",
        '  say("从场景跳过来");',
        "}",
        "",
        "export default function start(): void {",
        '  jump("goToLabel");',
        "}",
        "",
      ].join("\n"),
      "src/scenes/kitchen/kitchen.vue": "<template><div /></template>\n",
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.columns).toBe(2);
    const columns = columnsOf(root);
    expect(columns.get("start")?.kind).toBe("scene");
    expect(columns.get("start")?.body).toEqual({ name: "kitchen" });
    expect(columns.get("goToLabel")?.kind).toBe("flow");
    expect(says(columns.get("goToLabel"))).toEqual(["从场景跳过来"]);
  });
});

/**
 * 列身体声明（`columnKind` / `body` / `bodyProps`）契约测试。
 *
 * TS 创作链让一列可以是「场景列」：`export const columnKind = "scene"` 声明形态，
 * `export const body = kitchen` 指认身体组件，`export const bodyProps = {…}` 给静态
 * 属性。三者的产物口径：
 * - `kind:"scene"` 的列**不产** `elements`（身体是组件，不是元素序列），也不产
 *   `commands`；它的可执行内容是 `entry`（进列时跑一遍，等同 `mount` 前的准备）；
 * - `body` 是 `{ name, props? }`，`name` = 场景目录名，`props` 原样写给 `SYS.body`；
 * - 不写 `columnKind` 等价于 `"flow"`，产物与今天逐字节相同。
 *
 * 三条 fail-closed 各有落点：`columnKind` 非契约取值、`body` 不是场景句柄、
 * `bodyProps` 不是静态对象字面量。全部要有 源文件:行:列。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";

const BASE = fileURLToPath(new URL("./.tmp-column-kind/", import.meta.url));

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
  "name": "列身体工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const START = "src/Stories.src/ch1/start.ts";
const START_JSON = "Resources/Stories/ch1/start.json";
const KITCHEN_VUE = "<template><div /></template>\n";

/** 一个带 kitchen 场景的最小工程；`head` 是待测的模块顶层声明 */
function sceneProject(
  name: string,
  head: string,
  body = `  say("进来");\n`,
): string {
  return makeProject(name, {
    "src/Stories.src/config.ts": config(["ch1"]),
    [START]: `${head}\n${WORDS}export default function start(): void {\n${body}}\n`,
    "src/scenes/kitchen/kitchen.vue": KITCHEN_VUE,
    "Resources/project.json": MANIFEST,
  });
}

/** 读产出的列对象（单列形态） */
function columnOf(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, START_JSON), "utf8"));
}

const REGISTER_IMPORT = 'import { kitchen } from "../../gen/scene_register.g";';

/** 场景列的完整头部：导入句柄 + 三个声明 */
function sceneHead(props?: string): string {
  return [
    REGISTER_IMPORT,
    'export const columnKind = "scene";',
    "export const body = kitchen;",
    ...(props === undefined ? [] : [`export const bodyProps = ${props};`]),
  ].join("\n");
}

describe("列身体 · 产物形态", () => {
  it("scene 列：产出 body + entry，不产 elements、不产 commands", async () => {
    const root = sceneProject("scene-basic", sceneHead());
    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    const column = columnOf(root);
    expect(column.kind).toBe("scene");
    expect(column.body).toEqual({ name: "kitchen" });
    // 身体是组件，不是元素序列：补一个空 elements 会与 body 语义冲突
    expect(column.elements).toBeUndefined();
    // 可执行内容是 entry（进列时跑一遍），不是 commands
    expect(column.commands).toBeUndefined();
    expect(Array.isArray(column.entry)).toBe(true);
  });

  it("scene 列 + bodyProps：props 原样进 body，键序即书写序", async () => {
    const root = sceneProject(
      "scene-props",
      sceneHead('{ title: "厨房", image: "Images/kitchen.svg", depth: 2 }'),
    );
    await buildStories(root);
    expect(columnOf(root).body).toEqual({
      name: "kitchen",
      props: { title: "厨房", image: "Images/kitchen.svg", depth: 2 },
    });
  });

  it("scene 列 + 空 bodyProps：产物不带 props 键（与 JSON 形态同源同产物）", async () => {
    const root = sceneProject("scene-empty-props", sceneHead("{}"));
    await buildStories(root);
    expect(columnOf(root).body).toEqual({ name: "kitchen" });
  });

  it("bodyProps 允许嵌套对象与数组：JSON 安全值全收", async () => {
    const root = sceneProject(
      "scene-nested-props",
      sceneHead("{ hot: { spots: [1, 2, 3], open: true }, note: null }"),
    );
    await buildStories(root);
    expect(columnOf(root).body).toEqual({
      name: "kitchen",
      props: { hot: { spots: [1, 2, 3], open: true }, note: null },
    });
  });

  it("不写 columnKind：等价 flow，产物与今天逐字节相同（无 body）", async () => {
    const root = makeProject("plain-flow", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `${WORDS}export default function start(): void {\n  say("你好");\n}\n`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const column = columnOf(root);
    expect(column.kind).toBe("flow");
    expect(column.body).toBeUndefined();
    expect(column.elements).toBeUndefined();
    expect(Array.isArray(column.commands)).toBe(true);
    expect(column.entry).toBeUndefined();
  });

  it('显式 columnKind = "flow"：与不写等价', async () => {
    const root = makeProject("explicit-flow", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnKind = "flow";\n\n${WORDS}export default function start(): void {\n  say("你好");\n}\n`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    const column = columnOf(root);
    expect(column.kind).toBe("flow");
    expect(column.body).toBeUndefined();
    expect(Array.isArray(column.commands)).toBe(true);
  });

  it("scene 列仍可声明 columnType：两个面正交", async () => {
    const root = sceneProject(
      "scene-with-type",
      `export const columnType = "game";\n${sceneHead()}`,
    );
    await buildStories(root);
    const column = columnOf(root);
    expect(column.kind).toBe("scene");
    // game 是缺省值，照 flow 的既有口径不写 type
    expect(column.type).toBeUndefined();
    expect(column.body).toEqual({ name: "kitchen" });
  });
});

describe("列身体 · fail-closed", () => {
  it("columnKind 非契约取值 ⇒ 报错并带源文件:行:列", async () => {
    const root = mapProjectWithKind(
      "kind-bad-value",
      'export const columnKind = "view";',
    );
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*columnKind 必须折叠为 "scene" 或 "flow" 字面量/,
    );
  });

  it("columnKind 取运行期值（折叠不出来）⇒ 同一条错", async () => {
    // 词函数调用不是静态值：`columnKind` 要求构建期可判定，运行期才知道形态
    // 意味着产物形态不确定
    await expect(
      buildStories(
        mapProjectWithKind(
          "kind-runtime-value",
          "export const columnKind = pick();",
          'function pick(): string {\n  return "scene";\n}\n',
        ),
      ),
    ).rejects.toThrow(/columnKind 必须折叠为 "scene" 或 "flow" 字面量/);
  });

  it("columnKind 走可折叠 const 也认：静态判定的传递性", async () => {
    const root = mapProjectWithKind(
      "kind-folded-const",
      'const mode = "flow";\nexport const columnKind = mode;',
    );
    await buildStories(root);
    expect(columnOf(root).kind).toBe("flow");
  });

  it("body 指向非场景句柄（字符串）⇒ 报错", async () => {
    const root = mapProjectWithKind(
      "body-string",
      'export const body = "kitchen";',
    );
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*body 必须是从 scene_register\.g 具名导入的组件句柄/,
    );
  });

  it("body 指向 UI 句柄（不是场景）⇒ 报错", async () => {
    const root = makeProject("body-ui-handle", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: [
        'import { hub } from "../../gen/ui_register.g";',
        'export const columnKind = "scene";',
        "export const body = hub;",
        "",
        `${WORDS}export default function start(): void {\n  say("x");\n}\n`,
      ].join("\n"),
      "src/ui/hub/hub.vue": KITCHEN_VUE,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /body 必须是从 scene_register\.g 具名导入的组件句柄/,
    );
  });

  it('columnKind = "scene" 但没写 body ⇒ 报错（场景列必须有身体）', async () => {
    const root = makeProject("scene-without-body", {
      "src/Stories.src/config.ts": config(["ch1"]),
      [START]: `export const columnKind = "scene";\n\n${WORDS}export default function start(): void {\n  say("x");\n}\n`,
      "src/scenes/kitchen/kitchen.vue": KITCHEN_VUE,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*columnKind 声明为 scene 时必须同时声明 body/,
    );
  });

  it("bodyProps 不是对象字面量 ⇒ 报错", async () => {
    const root = sceneProject("props-not-object", sceneHead("spread(props)"));
    await expect(buildStories(root)).rejects.toThrow(
      /ch1\/start\.ts:\d+:\d+[\s\S]*bodyProps 必须是静态对象字面量/,
    );
  });

  it("bodyProps 含非静态值（函数调用）⇒ 报错", async () => {
    const root = sceneProject(
      "props-non-static",
      sceneHead("{ title: pick() }"),
    );
    await expect(buildStories(root)).rejects.toThrow(
      /bodyProps 必须是静态对象字面量/,
    );
  });

  it("bodyProps 只有字符串（不是对象）⇒ 报错", async () => {
    const root = sceneProject("props-string", sceneHead('"厨房"'));
    await expect(buildStories(root)).rejects.toThrow(
      /bodyProps 必须是静态对象字面量/,
    );
  });

  it("声明只能写在故事文件顶层：纯模块里写 columnKind ⇒ 报错", async () => {
    const root = makeProject("kind-in-module", {
      "src/Stories.src/config.ts": config(["ch1"]),
      "src/Stories.src/ch1/lib/pick.ts":
        'export const columnKind = "scene";\n\nexport function pick(): string {\n  return "x";\n}\n',
      [START]: `${WORDS}export default function start(): void {\n  say("x");\n}\n`,
      "Resources/project.json": MANIFEST,
    });
    await expect(buildStories(root)).rejects.toThrow(
      /columnKind 只能声明在故事文件（default 导出列）的模块顶层/,
    );
  });
});

/** 构造一个只在头部写一条待测声明的工程 */
function mapProjectWithKind(
  name: string,
  head: string,
  extraModule = "",
): string {
  return makeProject(name, {
    "src/Stories.src/config.ts": config(["ch1"]),
    [START]: `${head}\n\n${WORDS}${extraModule}export default function start(): void {\n  say("x");\n}\n`,
    "src/scenes/kitchen/kitchen.vue": KITCHEN_VUE,
    "Resources/project.json": MANIFEST,
  });
}

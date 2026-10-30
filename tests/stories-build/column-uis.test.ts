/**
 * 列级 `uis` 的汇编期收集与构建期闸门。
 *
 * 三个不变量：
 * - **从图谱登记取，不现扫导入**：名字集合来自 `ModuleRecord.uis`（导入期已判定过的
 *   落位结果），装配期只做排序去重，不再回看 import 子句——两处各自判定就会各自演化；
 * - **顺序由数据决定**：同一组名字无论书写顺序如何，产物字节必须一致；
 * - **声明必须落地**：产物里出现的名字，源里得有 `ui/<名>/<名>.<扩展名>` 那个文件，
 *   否则宿主预加载落空、界面到挂载瞬间才出现——这类笔误在构建期就该红。
 *
 * `mount` 与 `uis` 的互锁也在这里验：命令里挂了某 UI 而列没导入它，等于产物缺声明。
 * 该判定不依赖 `mount` 是否为内建 op（只认命令形状），故可在 op 落地前先行就位。
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
import { buildGraph } from "../../packages/stories-build/src/compiler/story-compiler/graph/build.ts";
import { createAliasResolver } from "../../packages/stories-build/src/compiler/story-compiler/graph/scan/alias.ts";
import { loadPathsConfig } from "../../packages/stories-build/src/pipeline/tsconfig-paths.ts";
import { DiagBag } from "../../packages/stories-build/src/compiler/story-compiler/graph/core.ts";
import {
  compileStoryFile,
  createAssembleSession,
} from "../../packages/stories-build/src/compiler/story-compiler/assemble/session.ts";

const BASE = fileURLToPath(new URL("./.tmp-column-uis/", import.meta.url));

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
  'export const folders = ["chapter1"];\nexport const start = "start.ts";\n';

const MANIFEST = `{
  "formatVersion": 1,
  "name": "列级 UI 声明工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

const START = "src/Stories.src/chapter1/start.ts";
const PRODUCT = "Resources/Stories/chapter1/start.json";

/** 故事文件：按给定顺序导入若干 UI 后说一句话（导入顺序 = 书写顺序）。 */
function storyImporting(names: readonly string[]): string {
  const imports = names
    .map((name) => `import ${name} from "../../ui/${name}/${name}.vue";`)
    .join("\n");
  return `${WORDS}${imports}\n\nexport default function start(): void {\n  say("开屏");\n}\n`;
}

/** 工程：配置 + 清单 + 故事文件 + 每个 UI 的实现文件（`ui/<名>/<名>.vue`）。 */
function project(
  name: string,
  imported: readonly string[],
  present: readonly string[],
): string {
  const files: Record<string, string> = {
    "src/Stories.src/config.ts": CONFIG,
    [START]: storyImporting(imported),
    "Resources/project.json": MANIFEST,
  };
  for (const ui of present) {
    files[`src/ui/${ui}/${ui}.vue`] = "<template><div /></template>\n";
  }
  return makeProject(name, files);
}

function productColumn(root: string): Record<string, unknown> {
  const text = readFileSync(join(root, PRODUCT), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

describe("列级 uis · 汇编期收集", () => {
  it("导入的 UI 名字进产物，按码点序排列", async () => {
    const root = project("collected", ["map", "hub"], ["map", "hub"]);
    await buildStories(root);
    expect(productColumn(root).uis).toEqual(["hub", "map"]);
  });

  it("顺序确定：两种书写顺序产出逐字节相同的列文件", async () => {
    const forward = project("order-forward", ["hub", "map"], ["hub", "map"]);
    const backward = project("order-backward", ["map", "hub"], ["hub", "map"]);
    await buildStories(forward);
    await buildStories(backward);
    expect(readFileSync(join(forward, PRODUCT), "utf8")).toBe(
      readFileSync(join(backward, PRODUCT), "utf8"),
    );
  });

  it("没有导入 UI 的列 ⇒ 产物不带 uis 键（零打扰）", async () => {
    const root = makeProject("no-ui", {
      "src/Stories.src/config.ts": CONFIG,
      [START]: `${WORDS}export default function start(): void {\n  say("开屏");\n}\n`,
      "Resources/project.json": MANIFEST,
    });
    await buildStories(root);
    expect("uis" in productColumn(root)).toBe(false);
  });
});

describe("列级 uis · mount 互锁", () => {
  /** 装配单个故事文件，返回诊断消息（不落盘，不经过 op 闸门）。 */
  function assembleDiags(
    name: string,
    body: string,
    uiFiles: readonly string[],
  ): string[] {
    const imports = uiFiles
      .map((ui) => `import ${ui} from "../../ui/${ui}/${ui}.vue";`)
      .join("\n");
    const words = `import { script } from "@lingfan-engine/editor";
const { say, extOp } = script;
${imports === "" ? "" : `${imports}\n`}
`;
    const files: Record<string, string> = {
      "src/Stories.src/config.ts": CONFIG,
      [START]: `${words}export default function start(): void {\n${body}\n}\n`,
    };
    for (const ui of uiFiles) {
      files[`src/ui/${ui}/${ui}.vue`] = "<template><div /></template>\n";
    }
    const root = makeProject(name, files);
    const diags = new DiagBag();
    const graph = buildGraph(
      join(root, "src/Stories.src"),
      diags,
      { folders: ["chapter1"], start: "start.ts" },
      undefined,
      undefined,
      createAliasResolver(loadPathsConfig(root), join(root, "src")),
    );
    expect(graph).not.toBeNull();
    const session = createAssembleSession();
    compileStoryFile(session, graph!, diags, "chapter1/start.ts");
    return diags.list().map((diag) => diag.message);
  }

  it("挂了未导入的 UI ⇒ 诊断指名该 UI 与补救路径", () => {
    const messages = assembleDiags(
      "mount-undeclared",
      '  say("开屏");\n  extOp("mount", { name: "hub" });',
      [],
    );
    const joined = messages.join("\n");
    expect(joined).toContain('mount("hub") 引用了本列未导入的 UI');
    expect(joined).toContain("../../ui/hub/hub.vue");
  });

  it("已导入的 UI 挂载 ⇒ 无诊断（互锁不误报）", () => {
    const messages = assembleDiags(
      "mount-declared",
      '  say("开屏");\n  extOp("mount", { name: "hub" });',
      ["hub"],
    );
    expect(messages).toEqual([]);
  });
});

describe("列级 uis · 构建期闸门", () => {
  it("声明的 UI 在源里没有实现文件 ⇒ 构建失败（fail-closed，零写盘）", async () => {
    // 导入期只做语法落位判定，不查文件是否存在 ⇒ 这里能造出「有声明无实现」的产物。
    const root = project("ghost-ui", ["ghost"], []);
    await expect(buildStories(root)).rejects.toThrow(
      /列级 uis 声明了源里不存在的 UI[\s\S]*ui "ghost"[\s\S]*\/columns\/0/,
    );
    expect(existsSync(join(root, "Resources/Stories"))).toBe(false);
  });

  it("实现文件齐备 ⇒ 构建通过（闸门不误伤）", async () => {
    const root = project("ui-present", ["hub"], ["hub"]);
    await expect(buildStories(root)).resolves.toBeDefined();
  });
});

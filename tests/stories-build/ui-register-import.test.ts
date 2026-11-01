/**
 * UI 注册表的导入通道：`import { hub } from "../../gen/ui_register.g"`。
 *
 * UI 句柄有两种写法，语义完全相同：
 * - default 导入 UI 文件：`import hub from "../../ui/hub/hub.vue"`；
 * - 命名导入注册表：`import { hub } from "../../gen/ui_register.g"`。
 * 后者一条说明符能同时供出所有句柄，名字来自注册表键而不是说明符本身，所以具名导入
 * 必须逐个去注册表里查——查不到就是笔误，fail-closed。
 *
 * 注册表说明符没有 UI 扩展名（`.vue` / `.tsx` / `.html` / `.ts`），因此它不走扩展名
 * 判定，由 UI 通道单独认这一条形状。认出之后它就在模块图之前被截住：`gen/` 生成物
 * 不参与创作导入那条规则照旧拦其它生成物，一个字都不用改。
 *
 * 断言分四层：
 * - 产物层（`buildStories` 整链）看折叠后的字节，四种写法必须逐字节相同；
 * - 图谱层（`buildGraph` 直调 + 显式注册表）看登记与别名折叠；
 * - 诊断层看四类 fail-closed：未登记名、default 导入、命名空间导入、副作用导入；
 * - 边界层看两侧仍各拦各的：故事源侧拦 `gen/`，UI 侧拦跨层引用。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";
import { buildGraph } from "../../packages/stories-build/src/compiler/story-compiler/graph/build.ts";
import { createAliasResolver } from "../../packages/stories-build/src/compiler/story-compiler/graph/scan/alias.ts";
import { loadPathsConfig } from "../../packages/stories-build/src/pipeline/tsconfig-paths.ts";
import { DiagBag } from "../../packages/stories-build/src/compiler/story-compiler/graph/core.ts";
import type {
  Graph,
  UiRegistryEntry,
} from "../../packages/stories-build/src/compiler/story-compiler/graph/core.ts";
import {
  checkUiImports,
  scanUiImports,
} from "../../packages/stories-build/src/ui/scan-imports.ts";

const BASE = fileURLToPath(
  new URL("./.tmp-ui-register-import/", import.meta.url),
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

const CONFIG =
  'export const folders = ["chapter1"];\nexport const start = "start.ts";\n';

const MANIFEST = `{
  "formatVersion": 1,
  "name": "UI 注册表导入工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { mount, say } = script;

`;

const TSCONFIG = `{
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}`;

const HUB_VUE = "<template><div /></template>\n";

/**
 * 一个只有 hub 的完整故事工程。
 *
 * `importLine` 是待测的那一行 UI 导入，`handle` 是它在命令里被用到的绑定名——
 * 两者分开传，才能表达 `import { hub as h }` 这类「说明符里的名字 ≠ 本地绑定名」。
 */
function storyProject(
  name: string,
  importLine: string,
  handle = "hub",
): string {
  return makeProject(name, {
    "tsconfig.json": TSCONFIG,
    "src/Stories.src/config.ts": CONFIG,
    "src/Stories.src/chapter1/start.ts": `${WORDS}${importLine}

export default function start(): void {
  mount(${handle}, true);
  say("开场");
}
`,
    "src/ui/hub/hub.vue": HUB_VUE,
    "Resources/project.json": MANIFEST,
  });
}

/** 构建后读产物：命令数组是折叠结果的字节证据。 */
async function productOf(root: string): Promise<string> {
  await buildStories(root);
  return readFileSync(
    join(root, "Resources/Stories/chapter1/start.json"),
    "utf8",
  );
}

/** 图谱层：显式传注册表（编排层才知道 `ui/` 在哪，编译器自己不扫目录）。 */
function graphOf(
  root: string,
  registry: readonly UiRegistryEntry[] = [],
): { graph: Graph; messages: string[] } {
  const diags = new DiagBag();
  const graph = buildGraph(
    join(root, "src/Stories.src"),
    diags,
    { folders: ["chapter1"], start: "start.ts" },
    undefined,
    undefined,
    createAliasResolver(loadPathsConfig(root), join(root, "src")),
    registry,
  );
  return { graph: graph!, messages: diags.list().map((d) => d.message) };
}

const HUB_ENTRY: UiRegistryEntry = { name: "hub", file: "hub.vue" };

describe("UI 注册表导入：与 default 导入 UI 文件语义相同", () => {
  it('相对命名导入：产物列 uis 含 hub，mount(hub, true) 折成 mount("hub", true)', async () => {
    const root = storyProject(
      "relative",
      'import { hub } from "../../gen/ui_register.g";',
    );
    const product = JSON.parse(await productOf(root)) as {
      uis: string[];
      commands: unknown[];
    };
    expect(product.uis).toEqual(["hub"]);
    expect(product.commands).toEqual([
      { op: "mount", name: "hub", visible: true },
      { op: "say", text: "开场" },
    ]);
  });

  it("带 .ts 后缀：与不带后缀是同一条说明符，产物逐字节相同", async () => {
    const plain = await productOf(
      storyProject("no-ext", 'import { hub } from "../../gen/ui_register.g";'),
    );
    const withExt = await productOf(
      storyProject(
        "with-ext",
        'import { hub } from "../../gen/ui_register.g.ts";',
      ),
    );
    expect(withExt).toBe(plain);
  });

  it("别名形态 @/gen/ui_register.g：与相对形态产物逐字节相同", async () => {
    const plain = await productOf(
      storyProject(
        "alias-plain",
        'import { hub } from "../../gen/ui_register.g";',
      ),
    );
    const aliased = await productOf(
      storyProject("alias-named", 'import { hub } from "@/gen/ui_register.g";'),
    );
    expect(aliased).toBe(plain);
  });

  it("别名 default 导入 UI 文件：与命名导入注册表产物逐字节相同", async () => {
    const named = await productOf(
      storyProject("named", 'import { hub } from "../../gen/ui_register.g";'),
    );
    const byFile = await productOf(
      storyProject("by-file", 'import hub from "@/ui/hub/hub.vue";'),
    );
    expect(byFile).toBe(named);
  });

  it("本地别名 import { hub as h }：绑定名只是语法糖，折叠仍用注册表里的名字", async () => {
    const root = storyProject(
      "local-alias",
      'import { hub as h } from "../../gen/ui_register.g";',
      "h",
    );
    const product = JSON.parse(await productOf(root)) as {
      commands: unknown[];
    };
    expect(product.commands[0]).toEqual({
      op: "mount",
      name: "hub",
      visible: true,
    });

    const { graph, messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toEqual([]);
    const record = graph.records.get("chapter1/start.ts")!;
    expect(record.uis.get("hub")?.relPath).toBe("ui/hub/hub.vue");
    // 绑定名 h 折成 UI 名 hub：折叠与落账用的是注册表键。
    expect(record.bindings.get("h")).toEqual({ kind: "ui", name: "hub" });
  });
});

describe("UI 注册表导入：fail-closed", () => {
  it("未登记的名字：报错并带上那个名字", () => {
    const root = makeProject("missing", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import { ghost } from "../../gen/ui_register.g";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("ghost");
    expect(messages[0]).toContain("UI 注册表里没有");
  });

  it("default 导入注册表：报「注册表没有默认导出」", () => {
    const root = makeProject("no-default", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import reg from "../../gen/ui_register.g";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("UI 注册表没有默认导出");
  });

  it("命名空间导入注册表：同样报「注册表没有默认导出」", () => {
    const root = makeProject("namespace", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import * as all from "../../gen/ui_register.g";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("UI 注册表没有默认导出");
  });

  it("副作用导入注册表：报「只提供句柄，请显式导入」", () => {
    const root = makeProject("side-effect", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import "../../gen/ui_register.g";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { messages } = graphOf(root, [HUB_ENTRY]);
    // 副作用导入另有模块图自己那条通用诊断，这里只认注册表这一条的存在。
    expect(
      messages.some((m) => m.includes("UI 注册表的副作用导入不支持")),
    ).toBe(true);
  });

  it("import type：不产生运行期绑定，无诊断也不进 uis", () => {
    const root = makeProject("type-only", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import type { hub } from "../../gen/ui_register.g";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { graph, messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toEqual([]);
    expect([...graph.records.get("chapter1/start.ts")!.uis.keys()]).toEqual([]);
  });
});

describe("边界：两条既有规则各拦各的", () => {
  it("故事源侧：源根内的 gen/ 生成物仍报「gen/ 生成物不参与创作导入」", () => {
    const root = makeProject("gen-inside", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import { guards } from "../gen/fun_register.g.ts";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toContain("gen/ 生成物不参与创作导入");
  });

  it("故事源侧：源根外的 src/gen/ 生成物被源根沙箱拦下", () => {
    const root = makeProject("gen-outside", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import { guards } from "../../gen/fun_register.g";

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
    });
    const { messages } = graphOf(root, [HUB_ENTRY]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("必须解析到相对 .ts 文件");
  });

  it("UI 侧：相对路径引注册表 ⇒ 报「UI 不得引用 src/ui 之外的文件」", () => {
    const source = `import { hub } from "../../gen/ui_register.g";\n`;
    const violations = checkUiImports(
      "ui/hub/hub.vue",
      scanUiImports(`<script setup lang="ts">\n${source}</script>\n`, ".vue"),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toContain("UI 不得引用 src/ui 之外的文件");
  });

  it("UI 侧：@/gen/ 别名引注册表 ⇒ 报「UI 不得依赖构建产物」", () => {
    const source = `import { hub } from "@/gen/ui_register.g";\n`;
    const violations = checkUiImports(
      "ui/hub/hub.vue",
      scanUiImports(`<script setup lang="ts">\n${source}</script>\n`, ".vue"),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toContain("UI 不得依赖构建产物");
  });

  it("cell 里引注册表：生成物搬运不把它当外部导入", async () => {
    const root = makeProject("cell-register", {
      "tsconfig.json": TSCONFIG,
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `import { script } from "@lingfan-engine/editor";
import { hub } from "../../gen/ui_register.g";
const { cell, say } = script;

export const hubCheck = cell("hub-check", (ctx, args) => {
  ctx.get("player.gold");
});

export default function start(): void {
  say("开场");
}
`,
      "src/ui/hub/hub.vue": HUB_VUE,
      "Resources/project.json": MANIFEST,
    });
    const report = await buildStories(root);
    expect(report.functions).toEqual(["hub-check"]);
    expect(report.added).toContain("src/gen/ui_register.g.ts");
  });
});

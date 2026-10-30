/**
 * UI 导入通道：`import hub from "…/ui/hub/hub.vue"` 一行拿到句柄。
 *
 * 这组断言盯的是「静态声明」四个字：编译器只记名字与位置，UI 文件本身不读、不编译、
 * 不进模块图；句柄在编译期等于它的名字（`export const picked = hub` 折成 `"hub"`）。
 *
 * 断言分三层：
 * - 图谱层（`buildGraph` 直调）看登记与**不登记**——`records.has("ui/hub/hub.vue")`
 *   必须为 false，UI 一旦混进模块图，`.vue` 会被当 TS 解析、常量求值随之崩；
 * - 产物层（`buildStories` 整链）看折叠后的字节：`say(picked)` 的 `text` 就是名字；
 * - 诊断层看四条 fail-closed：越界、文件名≠目录名、绑定名≠目录名、非 default 导入。
 *
 * 别名形态与相对形态必须落到同一个文件——两者等价是作者可自由选写法的前提。
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
import type { Graph } from "../../packages/stories-build/src/compiler/story-compiler/graph/core.ts";

const BASE = fileURLToPath(new URL("./.tmp-ui-import/", import.meta.url));

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
  "name": "UI 导入工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

/** 图谱层：直接建图，拿到 records / uis 供断言（不走产物）。 */
function graphOf(root: string): Graph {
  const diags = new DiagBag();
  const graph = buildGraph(
    join(root, "src/Stories.src"),
    diags,
    { folders: ["chapter1"], start: "start.ts" },
    undefined,
    undefined,
    createAliasResolver(loadPathsConfig(root), join(root, "src")),
  );
  const list = diags.list();
  expect(list.map((d) => d.message)).toEqual([]);
  expect(graph).not.toBeNull();
  return graph!;
}

function uiNames(graph: Graph, rel: string): string[] {
  const record = graph.records.get(rel);
  expect(record).toBeDefined();
  return [...record!.uis.keys()].sort();
}

describe("UI 导入通道（T02：一行 import 得句柄）", () => {
  it(".vue：登记名字与相对 src/ 的位置，文件自身不进模块图", () => {
    const root = makeProject("ui-vue", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import hub from "../../ui/hub/hub.vue";

export default function start(): void {
  say(hub.name);
}
`,
      "src/ui/hub/hub.vue": "<template><div /></template>\n",
    });

    const graph = graphOf(root);
    expect(uiNames(graph, "chapter1/start.ts")).toEqual(["hub"]);
    const record = graph.records.get("chapter1/start.ts")!;
    expect(record.uis.get("hub")?.relPath).toBe("ui/hub/hub.vue");
    expect(record.bindings.get("hub")).toEqual({ kind: "ui", name: "hub" });
    // UI 文件不是 TS 模块：进 records 就会被当 TS 解析、参与常量求值。
    expect(graph.records.has("ui/hub/hub.vue")).toBe(false);
  });

  it(".tsx：同样走 UI 通道", () => {
    const root = makeProject("ui-tsx", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import panel from "../../ui/panel/panel.tsx";

export default function start(): void {
  say(panel.name);
}
`,
      "src/ui/panel/panel.tsx": "export default null;\n",
    });

    const graph = graphOf(root);
    expect(uiNames(graph, "chapter1/start.ts")).toEqual(["panel"]);
    expect(graph.records.has("ui/panel/panel.tsx")).toBe(false);
  });

  it(".html：同样走 UI 通道", () => {
    const root = makeProject("ui-html", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import sheet from "../../ui/sheet/sheet.html";

export default function start(): void {
  say(sheet.name);
}
`,
      "src/ui/sheet/sheet.html": "<div></div>\n",
    });

    const graph = graphOf(root);
    expect(uiNames(graph, "chapter1/start.ts")).toEqual(["sheet"]);
    expect(graph.records.has("ui/sheet/sheet.html")).toBe(false);
  });

  it(".ts 落位合上 ui/<名>/<名>.ts 时走 UI，不进模块图", () => {
    const root = makeProject("ui-ts", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import toast from "../../ui/toast/toast.ts";

export default function start(): void {
  say(toast.name);
}
`,
      "src/ui/toast/toast.ts": "export default null;\n",
    });

    const graph = graphOf(root);
    expect(uiNames(graph, "chapter1/start.ts")).toEqual(["toast"]);
    expect(graph.records.has("ui/toast/toast.ts")).toBe(false);
  });

  it("源树里的 .ts 仍走模块图：位置不合 ui/<名>/<名> 就不当 UI", () => {
    // 两种说明符都要覆盖：不带扩展名的写法走「不是 UI 扩展名」这条快路；显式带 `.ts`
    // 的写法则一路走到位置判定——那里若把 `.ts` 也当越界，源树里的普通模块就没法导了。
    const root = makeProject("ui-ts-inside", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/tools.ts": `${WORDS}export const helper = "工具";

`,
      "src/Stories.src/chapter1/more.ts": `${WORDS}export const helper2 = "更多";

`,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import { helper } from "./tools";
import { helper2 } from "./more.ts";

export default function start(): void {
  say(helper);
  say(helper2);
}
`,
    });

    const graph = graphOf(root);
    expect(graph.records.has("chapter1/tools.ts")).toBe(true);
    expect(graph.records.has("chapter1/more.ts")).toBe(true);
    expect(uiNames(graph, "chapter1/start.ts")).toEqual([]);
  });

  it("源树外的普通 .ts 说明符交回模块图：不是 UI，也不是 UI 越界", () => {
    // `.ts` 同时是故事源自己的扩展名，所以位置不合 `ui/<名>/<名>.ts` 时它只是一个普通
    // 模块说明符——诊断该是模块图那条「必须解析到相对 .ts 文件」，而不是 UI 越界。
    const root = makeProject("ui-ts-outside-plain", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import { helper } from "../../lib/helper.ts";

export default function start(): void {
  say(helper);
}
`,
      "src/lib/helper.ts": 'export const helper = "外部模块";\n',
    });

    const diags = new DiagBag();
    buildGraph(join(root, "src/Stories.src"), diags, {
      folders: ["chapter1"],
      start: "start.ts",
    });
    expect(diags.list().map((d) => d.message)).toEqual([
      expect.stringMatching(/必须解析到相对 \.ts 文件/),
    ]);
  });

  it("别名形态与相对形态解析到同一文件", () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
      }),
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/alias-form.ts": `${WORDS}import hub from "@/ui/hub/hub.vue";

export default function aliasForm(): void {
  say(hub.name);
}
`,
      "src/Stories.src/chapter1/relative-form.ts": `${WORDS}import hub from "../../ui/hub/hub.vue";

export default function relativeForm(): void {
  say(hub.name);
}
`,
      "src/ui/hub/hub.vue": "<template><div /></template>\n",
    };
    const root = makeProject("ui-alias-same", files);

    const graph = graphOf(root);
    const aliasPath = graph.records
      .get("chapter1/alias-form.ts")!
      .uis.get("hub")?.relPath;
    const relativePath = graph.records
      .get("chapter1/relative-form.ts")!
      .uis.get("hub")?.relPath;
    expect(aliasPath).toBe("ui/hub/hub.vue");
    expect(relativePath).toBe("ui/hub/hub.vue");
  });

  it('折叠：export const picked = hub 折成名字，产物里就是 "hub"', async () => {
    const root = makeProject("ui-fold", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import hub from "../../ui/hub/hub.vue";

export const picked = hub;

export default function start(): void {
  say(picked);
}
`,
      "src/ui/hub/hub.vue": "<template><div /></template>\n",
      "Resources/project.json": MANIFEST,
    });

    await buildStories(root);
    const product = JSON.parse(
      readFileSync(join(root, "Resources/Stories/chapter1/start.json"), "utf8"),
    ) as { commands: Array<{ op: string; text?: string }> };
    expect(product.commands).toEqual([{ op: "say", text: "hub" }]);
  });

  it("相对形态越出 src/ 一级以上 ⇒ fail-closed 报越界", () => {
    const root = makeProject("ui-outside-relative", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import stray from "../../../outside/stray.vue";

export default function start(): void {
  say(stray.name);
}
`,
      "outside/stray.vue": "<div></div>\n",
    });

    const diags = new DiagBag();
    buildGraph(join(root, "src/Stories.src"), diags, {
      folders: ["chapter1"],
      start: "start.ts",
    });
    expect(diags.list().map((d) => d.message)).toEqual([
      expect.stringMatching(
        /必须解析到 Stories\.src 的兄弟目录 `ui\/<名>\/<名>\.<扩展名>`/,
      ),
    ]);
  });

  it("相对形态落在源根内而非 ui/ 下 ⇒ fail-closed 报越界", () => {
    const root = makeProject("ui-outside-lib", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import stray from "../../lib/stray.vue";

export default function start(): void {
  say(stray.name);
}
`,
      "src/Stories.src/lib/stray.vue": "<div></div>\n",
    });

    const diags = new DiagBag();
    buildGraph(join(root, "src/Stories.src"), diags, {
      folders: ["chapter1"],
      start: "start.ts",
    });
    expect(diags.list()).toHaveLength(1);
    expect(diags.list()[0].message).toMatch(
      /必须解析到 Stories\.src 的兄弟目录/,
    );
  });

  it("别名指向 src/ 之外的 UI 文件 ⇒ fail-closed 报越界", () => {
    const root = makeProject("ui-outside-alias", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./*"] } },
      }),
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import stray from "@/host/stray.vue";

export default function start(): void {
  say(stray.name);
}
`,
      "host/stray.vue": "<div></div>\n",
    });

    const diags = new DiagBag();
    buildGraph(
      join(root, "src/Stories.src"),
      diags,
      { folders: ["chapter1"], start: "start.ts" },
      undefined,
      undefined,
      createAliasResolver(loadPathsConfig(root), join(root, "src")),
    );
    expect(diags.list()).toHaveLength(1);
    expect(diags.list()[0].message).toMatch(
      /必须解析到 Stories\.src 的兄弟目录/,
    );
  });

  it("绑定名与目录名不一致 ⇒ fail-closed", () => {
    const root = makeProject("ui-binding-name", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import h from "../../ui/hub/hub.vue";

export default function start(): void {
  say(h.name);
}
`,
      "src/ui/hub/hub.vue": "<template><div /></template>\n",
    });

    const diags = new DiagBag();
    buildGraph(join(root, "src/Stories.src"), diags, {
      folders: ["chapter1"],
      start: "start.ts",
    });
    expect(diags.list()).toHaveLength(1);
    expect(diags.list()[0].message).toMatch(/绑定名必须是目录名.*收到 `h`/);
  });

  it("文件名与目录名不一致 ⇒ fail-closed", () => {
    const root = makeProject("ui-file-name", {
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/chapter1/start.ts": `${WORDS}import hub from "../../ui/hub/other.vue";

export default function start(): void {
  say(hub.name);
}
`,
      "src/ui/hub/other.vue": "<template><div /></template>\n",
    });

    const diags = new DiagBag();
    buildGraph(join(root, "src/Stories.src"), diags, {
      folders: ["chapter1"],
      start: "start.ts",
    });
    expect(diags.list()).toHaveLength(1);
    expect(diags.list()[0].message).toMatch(
      /UI 文件名必须等于目录名.*收到 `other\.vue`/,
    );
  });
});

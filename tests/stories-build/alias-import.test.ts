/**
 * 工程 `tsconfig.json` 的 `paths` 别名在创作导入里生效。
 *
 * 别名属作者：作者在自己工程的 `tsconfig.json` 里写 `@/*`、`@ui/*` 或任意前缀，
 * stories-build 只负责读出来并解析。本文件锚四件事——别名到 `.ts` 模块能连通、
 * 别名到 UI 单文件能被解析器认出（交给上层判定形态）、别名笔误报「已读 paths 未命中」、
 * 别名越出源根 fail-closed。
 *
 * 断言分两层：
 * - 连通与诊断走**真实整链构建**（`buildStories` + 真实默认编译器），断言落在产物字节与
 *   抛出的诊断文案上——别名是否真生效，只有产物说了算；
 * - UI 单文件形态走**解析器**（`createAliasResolver`）：构建层是否接受 `.vue` 由 UI 导入
 *   通道决定，不属于别名解析这一段，故这里只断言「解析器确实定位到了那个文件」。
 *
 * 每个用例独立工程根：`loadStoryConfig` 走 `import()`，同进程内同路径命中 ESM 模块缓存。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildStories } from "@lingfan-engine/stories-build";
import { createAliasResolver } from "../../packages/stories-build/src/compiler/story-compiler/graph/scan/alias.ts";
import { loadPathsConfig } from "../../packages/stories-build/src/pipeline/tsconfig-paths.ts";

const BASE = fileURLToPath(new URL("./.tmp-alias-paths/", import.meta.url));

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
  "name": "别名导入工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const WORDS = `import { script } from "@lingfan-engine/editor";
const { say } = script;

`;

/** 读产物里的 `func` 名集——别名是否真把两个文件连起来，这里说了算 */
function funcNames(root: string): string[] {
  const text = readFileSync(
    join(root, "Resources/Stories/ch1/start.json"),
    "utf8",
  );
  const parsed = JSON.parse(text) as {
    commands: Array<{ op: string; name?: string }>;
  };
  return parsed.commands
    .filter((command) => command.op === "func")
    .map((command) => command.name ?? "");
}

describe("别名导入（工程 tsconfig 的 paths）", () => {
  it("别名指向 .ts 模块：跨文件函数照常连边，产物里出现那个函数", async () => {
    const root = makeProject("alias-module", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/Stories.src/*"] } },
      }),
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/ch1/tools.ts": `${WORDS}export function cheer(): void {
  say("加油");
}
`,
      "src/Stories.src/ch1/start.ts": `${WORDS}import { cheer } from "@/ch1/tools";

export default function start(): void {
  cheer();
}
`,
      "Resources/project.json": MANIFEST,
    });

    const report = await buildStories(root);
    expect(report.columns).toBe(1);
    expect(funcNames(root)).toEqual(["cheer"]);
  });

  it("别名指向 UI 单文件：解析器按 `src/` 沙箱定位到该文件，形态标为非 .ts", () => {
    const root = makeProject("alias-ui", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/ui/*": ["./src/ui/*"] } },
      }),
      "src/ui/hub/hub.vue": "<template><div /></template>\n",
    });

    // UI 单文件与故事源是同一棵树上的兄弟目录，沙箱根因此取 `src/` 而不是源根。
    const resolver = createAliasResolver(
      loadPathsConfig(root),
      join(root, "src"),
    );
    expect(resolver).toBeDefined();
    const outcome = resolver!.resolveSpecifier("@/ui/hub/hub.vue");
    expect(outcome.kind).toBe("other");
    expect(outcome.kind === "other" && outcome.rel).toBe("ui/hub/hub.vue");
  });

  it("别名笔误：诊断说明已读过 paths 且未命中该说明符", async () => {
    const root = makeProject("alias-miss", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./src/Stories.src/*"] } },
      }),
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/ch1/start.ts": `${WORDS}import { absent } from "@/ch1/absent";

export default function start(): void {
  say(absent);
}
`,
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(
      /已读 tsconfig\.json 的 paths，未命中 `@\/ch1\/absent`/,
    );
  });

  it("别名解析到源根之外：fail-closed 报越界，不静默丢弃", async () => {
    const root = makeProject("alias-outside", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./*"] } },
      }),
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/ch1/start.ts": `${WORDS}import { anything } from "@/outside";

export default function start(): void {
  say(anything);
}
`,
      "outside.ts": "export const anything = 1;\n",
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(/解析到源根之外/);
  });

  it("引擎包说明符不走别名表：宽通配 `@*` 也劫不走 `@lingfan-engine/core`", async () => {
    // `paths` 属作者，`@lingfan-engine/*` 属引擎契约。工程写一条能匹配引擎包的宽通配、
    // 且目标文件真实存在，判定仍须落在引擎分支上——否则作者一句 paths 就能换掉引擎语义。
    const root = makeProject("alias-hijack", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@*": ["./hijack/*"] } },
      }),
      "src/Stories.src/config.ts": CONFIG,
      "src/Stories.src/ch1/start.ts": `${WORDS}import { anything } from "@lingfan-engine/core";

export default function start(): void {
  say(anything);
}
`,
      "hijack/lingfan-engine/core.ts": "export const anything = 1;\n",
      "Resources/project.json": MANIFEST,
    });

    await expect(buildStories(root)).rejects.toThrow(/引擎包不参与创作导入/);
  });
});

/**
 * 源根位置与构建产物等价（迁入 `src/` 前后的行为锚点）。
 *
 * 三件事在这里锚住：
 * - **默认布局常量**：源根是 `src/Stories.src`、资源根仍是工程根的 `Resources`、
 *   生成物目录是源根父目录下的 `gen`。三者是工程布局的默认值，也是所有诊断文案里
 *   路径前缀的来源，改值即改可观测行为。
 * - **CLI 传参真的生效**：不带参数与显式写默认值必须得到同一份产物；而带非默认值时要
 *   真去读那个目录（只吃默认常量的实现会让后者静默落到默认路径上）。
 * - **产物与位置无关**：同一份故事源放在默认位置与放在旧的工程根位置，`Resources/Stories/**`
 *   逐字节相同——迁位是纯位置变更，不该带出任何产物差异。
 *
 * 比对一律落在文件字节上（不读 report 计数）：计数对了但内容变了，同样是回归。
 * 每个用例独立临时工程根；`config.ts` 走 `import()` 装载，同路径会命中 ESM 模块缓存。
 */
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GENERATED_DIR,
  DEFAULT_RESOURCES_DIR,
  DEFAULT_SOURCES_DIR,
  buildStories,
} from "@lingfan-engine/stories-build";
import { parseCliArgs } from "../../packages/stories-build/src/cli/cli.ts";

const BASE = fileURLToPath(new URL("./.tmp-sources-dir/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

const CONFIG =
  'export const folders = ["ch1"];\nexport const start = "start.ts";\n';

const MANIFEST = `{
  "formatVersion": 1,
  "name": "位置等价工程",
  "entry": "start",
  "shell": { "orientation": "auto" }
}`;

const START = `import { script } from "@lingfan-engine/editor";
const { say, menu, option } = script;

export default function start(): void {
  say("开场");
  menu("去哪", [option("左边", "left.ts")]);
}
`;

const LEFT = `import { script } from "@lingfan-engine/editor";
const { say } = script;

export default function left(): void {
  say("左边");
}
`;

/** 造工程：故事源落在 `sourcesDir` 之下（默认 = `src/Stories.src`） */
function makeProject(name: string, sourcesDir = DEFAULT_SOURCES_DIR): string {
  const root = join(BASE, name);
  const files: Record<string, string> = {
    [`${sourcesDir}/config.ts`]: CONFIG,
    [`${sourcesDir}/ch1/start.ts`]: START,
    [`${sourcesDir}/ch1/left.ts`]: LEFT,
    "Resources/project.json": MANIFEST,
  };
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

/** `Resources/Stories/**` 的逐文件字节快照（相对路径 → 内容） */
function snapshot(root: string): Record<string, string> {
  const dir = join(root, DEFAULT_RESOURCES_DIR, "Stories");
  const out: Record<string, string> = {};
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childAbs = join(abs, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(childAbs, childRel);
        continue;
      }
      out[childRel] = readFileSync(childAbs, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

describe("工程布局默认值", () => {
  it("源根在 src 下、资源根在工程根、生成物目录是源根父目录下的 gen", () => {
    expect(DEFAULT_SOURCES_DIR).toBe("src/Stories.src");
    expect(DEFAULT_RESOURCES_DIR).toBe("Resources");
    expect(DEFAULT_GENERATED_DIR).toBe("gen");
  });
});

describe("CLI 目录参数", () => {
  it("不带参数与显式写默认值得到同一份产物", async () => {
    const bare = makeProject("cli-bare");
    const bareArgs = parseCliArgs([bare]);
    expect(bareArgs.options).toEqual({});
    await buildStories(bareArgs.root, bareArgs.options);

    const explicit = makeProject("cli-explicit");
    const parsed = parseCliArgs([
      explicit,
      `--sources-dir=${DEFAULT_SOURCES_DIR}`,
      `--resources-dir=${DEFAULT_RESOURCES_DIR}`,
    ]);
    expect(parsed.options).toEqual({
      sourcesDir: DEFAULT_SOURCES_DIR,
      resourcesDir: DEFAULT_RESOURCES_DIR,
    });
    await buildStories(parsed.root, parsed.options);

    expect(snapshot(explicit)).toEqual(snapshot(bare));
  });

  it("非默认源目录真被读取（不是只吃默认常量）", async () => {
    const custom = makeProject("cli-custom", "source-tree");
    const parsed = parseCliArgs([custom, "--sources-dir=source-tree"]);
    expect(parsed.options.sourcesDir).toBe("source-tree");

    const report = await buildStories(parsed.root, parsed.options);
    expect(report.columns).toBe(2);
    expect(Object.keys(snapshot(custom)).sort()).toEqual([
      "ch1/left.json",
      "ch1/start.json",
    ]);
  });
});

describe("产物与源根位置无关", () => {
  it("同一份源放在 src/Stories.src 与放在工程根 Stories.src 产物逐字节相同", async () => {
    const root = makeProject("same-tree");
    // 旧位置 = 工程根的 Stories.src（迁位前的布局），内容与默认位置完全相同。
    cpSync(join(root, DEFAULT_SOURCES_DIR), join(root, "Stories.src"), {
      recursive: true,
    });

    await buildStories(root);
    const moved = snapshot(root);
    rmSync(join(root, DEFAULT_RESOURCES_DIR, "Stories"), {
      recursive: true,
      force: true,
    });

    await buildStories(root, { sourcesDir: "Stories.src" });
    expect(snapshot(root)).toEqual(moved);
    expect(Object.keys(moved).sort()).toEqual([
      "ch1/left.json",
      "ch1/start.json",
    ]);
  });
});

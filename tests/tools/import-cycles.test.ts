/**
 * import 环判据（仓库级源级扫描）。
 *
 * 为什么要有：环不报错、测试也常绿，只在打包器/加载顺序变化时炸；靠人眼读 import 守不住。
 * 口径：`from "spec"` **跨行解析**（多行 import 是常见写法，按行匹配会漏）、含裸 `import "spec"`
 * 与 `export * from`；只解析相对路径与 `@lingfan/<pkg>` 映射；候选补全 `.ts` / `.vue` /
 * `/index.ts` / `/index.vue`；`.d.ts` 不入图。
 *
 * 判据形态（与 `tests/ui/platform-neutral.test.ts` 的收口手法一致）：
 * 白名单 = 允许保留的非平凡强连通分量，**逐项相等**——新增环立刻失败；删掉一个就从白名单删一项。
 *
 * 词法判据前先剥掉注释：否则注释里的 `from "./x"` 例子会被当成真依赖。
 */
import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob(
  ["../../packages/*/src/**/*.{ts,vue}", "../../apps/*/src/**/*.{ts,vue}"],
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** glob 键 → 仓库相对路径（posix） */
function rel(key: string): string {
  return key.replace(/^\.\.\/\.\.\//, "").replace(/\\/g, "/");
}

/** 去注释（块注释 + 行注释），避免注释里的 import 例子入图 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** posix 路径归一（吃掉 `.` 与 `..`） */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** 取所在目录（posix） */
function dirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

const FROM_RE = /\bfrom\s*["']([^"']+)["']/g;
const BARE_RE = /\bimport\s*["']([^"']+)["']/g;

/** 解析一个 import 说明符到仓库内文件（解析不到返回 undefined：外部依赖、裸包等） */
function resolveSpecifier(
  fromRel: string,
  spec: string,
  files: ReadonlySet<string>,
): string | undefined {
  let base: string;
  if (spec.startsWith("@lingfan/")) {
    const pkg = spec.slice("@lingfan/".length).split("/")[0];
    base = `packages/${pkg}/src/index`;
  } else if (spec.startsWith(".")) {
    base = normalize(`${dirOf(fromRel)}/${spec}`);
  } else {
    return undefined;
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.vue`,
    `${base}/index.ts`,
    `${base}/index.vue`,
  ];
  return candidates.find((candidate) => files.has(candidate));
}

/** 扫出全仓 import 图（节点 = 仓库相对路径，边 = 文件内相对导入） */
function buildGraph(sources: Record<string, string>): Map<string, string[]> {
  const entries = Object.entries(sources)
    .map(([key, raw]) => [rel(key), raw] as const)
    .filter(([path]) => !path.endsWith(".d.ts"));
  const files = new Set(entries.map(([path]) => path));
  const graph = new Map<string, string[]>();
  for (const [path, raw] of entries) {
    const code = stripComments(raw);
    const deps = new Set<string>();
    for (const re of [FROM_RE, BARE_RE]) {
      for (const match of code.matchAll(re)) {
        const target = resolveSpecifier(path, match[1], files);
        if (target !== undefined && target !== path) deps.add(target);
      }
    }
    graph.set(path, [...deps]);
  }
  return graph;
}

/** Tarjan 强连通分量：返回节点数 > 1 的分量（每个分量的节点已排序） */
function findCycleComponents(graph: ReadonlyMap<string, string[]>): string[][] {
  let order = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  const visit = (node: string): void => {
    index.set(node, order);
    low.set(node, order);
    order += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let popped: string | undefined;
      do {
        popped = stack.pop();
        if (popped !== undefined) {
          onStack.delete(popped);
          component.push(popped);
        }
      } while (popped !== node);
      if (component.length > 1) components.push([...component].sort());
    }
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return components.sort((a, b) => a[0].localeCompare(b[0]));
}

/** 分量的可读签名（断言失败信息里直接看得见是哪个环） */
function signature(component: readonly string[]): string {
  return component.join(" → ");
}

/**
 * 允许保留的环白名单（逐项相等匹配；当前为空 = 全仓无环）。
 */
const KNOWN_CYCLES: readonly (readonly string[])[] = [];

describe("import 环判据（仓库级扫描）", () => {
  const graph = buildGraph(SOURCES);
  const components = findCycleComponents(graph);

  it("扫描面非空（glob 失配时立刻失败，不许空转通过）", () => {
    expect(graph.size).toBeGreaterThanOrEqual(300);
  });

  it("判据自证：合成图能判出环，也能判出无环", () => {
    const cyclic = new Map([
      ["x/a.ts", ["x/b.ts"]],
      ["x/b.ts", ["x/a.ts"]],
      ["x/c.ts", []],
    ]);
    expect(findCycleComponents(cyclic).map(signature)).toEqual([
      "x/a.ts → x/b.ts",
    ]);

    const acyclic = new Map([
      ["x/a.ts", ["x/b.ts"]],
      ["x/b.ts", ["x/c.ts"]],
      ["x/c.ts", []],
    ]);
    expect(findCycleComponents(acyclic)).toEqual([]);
  });

  it("解析器自证：跨行 import、`export * from`、`index.ts` 补全都入图", () => {
    const sources: Record<string, string> = {
      "../../pkg/src/entry.ts":
        'import {\n  a,\n} from "./a";\nexport * from "./b";\nimport "./side";',
      "../../pkg/src/a.ts": "export const a = 1;",
      "../../pkg/src/b.ts": "export const b = 1;",
      "../../pkg/src/side.ts": "export const s = 1;",
    };
    const built = buildGraph(sources);
    expect(built.get("pkg/src/entry.ts")).toEqual([
      "pkg/src/a.ts",
      "pkg/src/b.ts",
      "pkg/src/side.ts",
    ]);
  });

  it("全仓无非白名单环（新增环必须当场拆掉或补白名单并留痕）", () => {
    const actual = components.map(signature);
    const expected = KNOWN_CYCLES.map((component) =>
      signature([...component].sort()),
    );
    expect(
      actual,
      `实际环分量与白名单不一致（新增环请拆掉，不要补白名单）：\n实际：\n${actual.join("\n")}\n白名单：\n${expected.join("\n")}`,
    ).toEqual(expected);
  });
});

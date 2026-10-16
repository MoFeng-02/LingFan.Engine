import { describe, expect, it, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 门禁脚本以 `.mjs` 落在根 `scripts/` 下（该目录的既有形态，不在 tsconfig 的 include 里），
 * 所以测试**按原文件运行时导入**而不是静态导入：脚本保持零构建可跑，也不必为了测试
 * 给全仓 tsc 打开 allowJs。代价是这里拿不到静态类型——断言全落在返回值的形状上。
 */
const auditDir = new URL("../../scripts/audit-runtime/", import.meta.url);
const { walkGraph, extractSpecifiers, stripComments } = await import(
  /* @vite-ignore */ new URL("graph.mjs", auditDir).href
);
const { classifySpecifier, scanProcessUsage } = await import(
  /* @vite-ignore */ new URL("specifiers.mjs", auditDir).href
);
const { runAudit, auditFailures, RUN_TIME_ROOTS, BUILD_TIME_ONLY } = await import(
  /* @vite-ignore */ new URL("index.mjs", auditDir).href
);

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 最小假仓库：只为可达图准备 package.json 与源文件，不依赖真实工作区 */
function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "audit-runtime-fixture-"));
  fixtures.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const file = join(root, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, "utf8");
  }
  return root;
}

function workspacePackage(name: string, exports: Record<string, string> = { ".": "./src/index.ts" }) {
  return JSON.stringify({ name, version: "0.0.0", type: "module", exports }, null, 2);
}

describe("说明符分类", () => {
  it("Node 专属说明符一律判违规，其余各有归属", () => {
    expect(classifySpecifier("node:fs").kind).toBe("violation");
    expect(classifySpecifier("node:fs/promises").kind).toBe("violation");
    expect(classifySpecifier("fs/promises").kind).toBe("violation");
    expect(classifySpecifier("path").kind).toBe("violation");
    expect(classifySpecifier("process").kind).toBe("violation");
    expect(classifySpecifier("./helper.ts").kind).toBe("relative");
    expect(classifySpecifier("../ui/index.ts").kind).toBe("relative");
    expect(classifySpecifier("@lingfan/engine").kind).toBe("workspace");
    expect(classifySpecifier("zod").kind).toBe("external");
    expect(classifySpecifier("zod").name).toBe("zod");
    expect(classifySpecifier("../logo/logo.svg").kind).toBe("relative");
    expect(classifySpecifier("logo.svg").kind).toBe("asset");
  });

  it("注释里的说明符与 process 用法都不作为证据", () => {
    const text = [
      '// import { readFileSync } from "node:fs";',
      "/* 历史写法：",
      '   import path from "node:path";',
      "   const cwd = process.cwd();",
      "*/",
      'import { z } from "zod";',
    ].join("\n");
    expect(extractSpecifiers(text).map((item: { spec: string }) => item.spec)).toEqual(["zod"]);
    expect(scanProcessUsage(stripComments(text))).toEqual([]);
  });

  it("process 成员用法给出准确行号", () => {
    const hits = scanProcessUsage('const a = 1;\nconst env = process.env.MODE ?? "";\n');
    expect(hits).toEqual([{ line: 2, text: "process.env" }]);
  });
});

describe("可达图", () => {
  it("从入口沿相对导入走到底，目录索引入口也能解析", () => {
    const root = makeRepo({
      "packages/rt/package.json": workspacePackage("@lingfan/rt"),
      "packages/rt/src/index.ts": 'export { helper } from "./helper.ts";\n',
      "packages/rt/src/helper.ts": 'export { deep } from "./deep/index.ts";\nexport const helper = 1;\n',
      "packages/rt/src/deep/index.ts": "export const deep = 2;\n",
    });
    const graph = walkGraph(["@lingfan/rt"], root);
    const relOnly = [...graph.files].map((file: string) => relative(root, file).split("\\").join("/")).sort();
    expect(relOnly).toEqual([
      "packages/rt/src/deep/index.ts",
      "packages/rt/src/helper.ts",
      "packages/rt/src/index.ts",
    ]);
    expect(graph.violations).toEqual([]);
    expect(graph.unresolved).toEqual([]);
  });

  it("运行期包出现 node:fs 即变红，并指出文件与行号", () => {
    const root = makeRepo({
      "packages/bad/package.json": workspacePackage("@lingfan/bad"),
      "packages/bad/src/index.ts": 'export { ok } from "./inner.ts";\n',
      "packages/bad/src/inner.ts": 'import { readFileSync } from "node:fs";\nexport const ok = readFileSync;\n',
    });
    const graph = walkGraph(["@lingfan/bad"], root);
    expect(graph.violations).toHaveLength(1);
    expect(graph.violations[0].reason).toContain("node:fs");
    expect(relFromRepo(root, graph.violations[0].file)).toBe("packages/bad/src/inner.ts");
    expect(graph.violations[0].line).toBe(1);
    expect(auditFailures({ graph, buildTimeInGraph: [], sizeRows: [] })).toHaveLength(1);
  });

  it("运行期包出现 process 用法也变红", () => {
    const root = makeRepo({
      "packages/bad/package.json": workspacePackage("@lingfan/bad"),
      "packages/bad/src/index.ts": "export const env = process.env.MODE;\n",
    });
    const graph = walkGraph(["@lingfan/bad"], root);
    expect(graph.violations).toHaveLength(1);
    expect(graph.violations[0].reason).toContain("process.env");
  });

  it("构建期包不在扫描范围：只从运行期入口出发，它的 node:fs 不受影响", () => {
    const root = makeRepo({
      "packages/rt/package.json": workspacePackage("@lingfan/rt"),
      "packages/rt/src/index.ts": "export const rt = 1;\n",
      "packages/tool/package.json": workspacePackage("@lingfan/tool"),
      "packages/tool/src/index.ts": 'import { writeFileSync } from "node:fs";\nexport const tool = writeFileSync;\n',
    });
    const graph = walkGraph(["@lingfan/rt"], root);
    expect(graph.violations).toEqual([]);
    expect([...graph.files].map((file: string) => relFromRepo(root, file))).toEqual([
      "packages/rt/src/index.ts",
    ]);
  });

  it("解析失败的导入按失败处理，不静默放行", () => {
    const root = makeRepo({
      "packages/rt/package.json": workspacePackage("@lingfan/rt"),
      "packages/rt/src/index.ts": 'export { missing } from "./missing.ts";\n',
    });
    const graph = walkGraph(["@lingfan/rt"], root);
    expect(graph.unresolved).toHaveLength(1);
    expect(graph.unresolved[0].reason).toContain("相对导入解析失败");
  });
});

describe("真实仓库", () => {
  it("运行期可达图零 Node 专属依赖，构建期工具留在范围外", async () => {
    const result = await runAudit({ sizes: false });
    expect(result.graph.violations).toEqual([]);
    expect(result.graph.unresolved).toEqual([]);
    expect(result.buildTimeInGraph).toEqual([]);
    expect(auditFailures(result)).toEqual([]);
    expect(result.rootCount).toBe(RUN_TIME_ROOTS.length);
    expect(result.graph.files.size).toBeGreaterThan(250);
    expect([...result.graph.files].map((file: string) => relFromRepo(repoRoot, file))).toContain(
      "packages/engine/src/index.ts",
    );
    expect([...result.graph.externals].sort()).toEqual(["@tauri-apps/api/core", "@tauri-apps/api/event", "zod"]);
    for (const item of BUILD_TIME_ONLY) {
      expect([...result.graph.externals]).not.toContain(item);
    }
  });
});

function relFromRepo(root: string, file: string): string {
  return relative(root, file).split("\\").join("/");
}

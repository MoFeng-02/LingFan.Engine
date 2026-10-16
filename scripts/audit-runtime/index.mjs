/**
 * 运行期产物审计：随宿主分发的运行期包，其可达图内不得出现 Node 专属依赖（`node:*`、
 * Node 内建模块名、`process.*`），相对与工作区导入必须全部可解析，并实测产物体积
 * （minified / gzip；小程序主包按解压后字节计）。构建期工具不在此列——它们在 Node 里跑。
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";
import { walkGraph } from "./graph.mjs";
import { measureSizes } from "./sizes.mjs";

/**
 * 运行期包：随宿主分发、在 WebView / 小程序 / 老 WebView 里跑，**必须**平台中立。
 * 新增运行期包时把它加进这张表——可达图会跟着出口走，不必再登记文件清单。
 */
export const RUN_TIME_ROOTS = [
  "@lingfan/engine",
  "@lingfan/ui",
  "@lingfan/editor",
  "@lingfan/adapters",
];

/**
 * 体积实测对象：小程序侧真正可能进主包的三个包。适配器不在其中——它是宿主按平台挑的，
 * 各平台取不同子面（小程序只取小程序适配器），拿整个包计主包没有意义。
 */
export const SIZE_ENTRIES = ["@lingfan/engine", "@lingfan/ui", "@lingfan/editor"];

/**
 * 构建期工具**必须**留在图外：它们在 Node 里跑，用 node:fs 是本职，不是违规。
 * 门禁的范围界线就画在这里——只查运行期产物，构建期工具不受影响。
 */
export const BUILD_TIME_ONLY = [
  "@lingfan/stories-build",
  "packages/editor/src/script/generate-vocabulary.ts",
];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function rel(file) {
  return relative(repoRoot, file).split("\\").join("/");
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export async function runAudit({ sizes = true } = {}) {
  const graph = walkGraph(RUN_TIME_ROOTS, repoRoot);
  const buildTimeInGraph = BUILD_TIME_ONLY.filter((item) =>
    item.startsWith("@lingfan/")
      ? RUN_TIME_ROOTS.includes(item)
      : [...graph.files].some((file) => rel(file) === item),
  );
  const sizeRows = sizes
    ? await measureSizes({ repoRoot, entrySpecs: SIZE_ENTRIES })
    : [];
  return { graph, buildTimeInGraph, sizeRows, rootCount: RUN_TIME_ROOTS.length };
}

function collectFailures({ graph, buildTimeInGraph, sizeRows }) {
  const failures = [];
  for (const item of graph.violations) {
    failures.push(`${rel(item.file)}:${item.line} ${item.reason}`);
  }
  for (const item of graph.unresolved) {
    failures.push(`${rel(item.file)}:${item.line} ${item.reason}`);
  }
  if (buildTimeInGraph.length > 0) {
    failures.push(`构建期工具误入运行期可达图：${buildTimeInGraph.join("、")}`);
  }
  if (sizeRows.some((row) => !Number.isFinite(row.bytes))) {
    failures.push("体积实测未产出有效字节数");
  }
  return failures;
}

function printReport(result) {
  const { graph, buildTimeInGraph, sizeRows } = result;
  console.log("运行期产物审计（scripts/audit-runtime/index.mjs）");
  console.log(
    `  可达图：${graph.files.size} 个源文件，入口 ${result.rootCount} 个（${RUN_TIME_ROOTS.join("、")}）`,
  );
  console.log(`  第三方外依赖（不遍历，${graph.externals.size} 个）：${[...graph.externals].sort().join("、") || "无"}`);
  console.log(
    `  构建期工具在范围外：${buildTimeInGraph.length === 0 ? "是" : `否（误入图：${buildTimeInGraph.join("、")}）`}`,
  );

  if (graph.violations.length > 0) {
    console.log(`\n  Node 专属依赖 · 失败 ${graph.violations.length} 处：`);
    for (const item of graph.violations) {
      console.log(`    ${rel(item.file)}:${item.line}  ${item.reason}`);
    }
  } else {
    console.log("\n  Node 专属依赖 · 通过（可达图内零命中）");
  }
  if (graph.unresolved.length > 0) {
    console.log(`\n  导入可解析 · 失败 ${graph.unresolved.length} 处：`);
    for (const item of graph.unresolved) {
      console.log(`    ${rel(item.file)}:${item.line}  ${item.reason}`);
    }
  } else {
    console.log("  导入可解析 · 通过（相对与工作区导入全部可解析）");
  }

  if (sizeRows.length > 0) {
    console.log("\n  产物体积（minified / gzip，小程序主包上限约 2 MB = 2048 KB）：");
    const width = Math.max(...sizeRows.map((row) => row.label.length));
    for (const row of sizeRows) {
      console.log(
        `    ${row.label.padEnd(width)}  ${formatKb(row.bytes).padStart(10)}  ${formatKb(row.gzipBytes).padStart(10)}  ${row.note}`,
      );
    }
  }
}

/** 审计的失败清单（供 CLI 退出码与测试共用同一份判据，避免两处各写一套） */
export function auditFailures(result) {
  return collectFailures(result);
}

export function renderReport(result) {
  printReport(result);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const result = await runAudit({ sizes: !argv.includes("--no-sizes") });
  printReport(result);
  const failures = collectFailures(result);
  if (argv.includes("--json")) {
    const asRelative = (item) => ({ ...item, file: rel(item.file) });
    console.log(
      JSON.stringify(
        {
          files: result.graph.files.size,
          roots: RUN_TIME_ROOTS,
          violations: result.graph.violations.map(asRelative),
          unresolved: result.graph.unresolved.map(asRelative),
          externals: [...result.graph.externals].sort(),
          buildTimeInGraph: result.buildTimeInGraph,
          sizes: result.sizeRows,
          failures,
        },
        null,
        2,
      ),
    );
  }
  if (failures.length > 0) {
    console.error(`\n审计失败：${failures.length} 项`);
    process.exitCode = 1;
  }
}

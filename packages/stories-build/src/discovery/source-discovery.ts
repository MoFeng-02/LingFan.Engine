import { join } from "node:path";
import ts from "typescript";
import { walkFiles } from "../shared";
import { CONFIG_FILE, loadStoryConfig, type StorySourceConfig } from "../config";
import { StoryBuildError } from "../shared";

/**
 * 源发现 v2（多目录形态）：
 * - 编译域 = folders 显式目录递归 ∪（含 "*" 时全部含故事目录），始终排除生成物目录；
 * - 探测域 = Stories.src 递归全集（同样排除生成物）——覆盖外发现 default 导出 = E07
 *   fail-closed（Stories.src 是全量管理：未登记的新章节文件不进编译域，其旧产物会被
 *   当作陈旧产物删除，必须在发现期拦住）；
 * - 故事 = default 具名 function 声明（列 id = 函数名，编译器侧解析）；default 存在但
 *   匿名 / 表达式形态 = E05 fail-closed；仅具名导出 = 纯模块（无列，import 可达即可，
 *   不要求在 folders 内）；
 * - config.start = 入口故事文件名（含 .ts），跨探测域精确匹配，全局恰一（E04）。
 */
export interface DiscoveredSources {
  /** 故事文件（相对 `Stories.src/`，posix 排序）——default 具名 function 声明的 .ts */
  readonly stories: readonly string[];
  /** 模块文件（相对 `Stories.src/`，posix 排序）——被 import 的支撑 .ts（含覆盖外纯模块） */
  readonly modules: readonly string[];
  /** `config.start` 匹配到的入口故事（相对 `Stories.src/`） */
  readonly startSource: string;
  /** 布局声明（编排层复核 / 报告用） */
  readonly config: StorySourceConfig;
}

export async function discoverSources(
  root: string,
  sourcesDirName: string,
): Promise<DiscoveredSources> {
  const config = await loadStoryConfig(root, sourcesDirName);
  const tree = walkFiles(join(root, sourcesDirName));
  const dirs = collectCoveredDirs(config, tree);

  // —— 探测域：全部 .ts（排除生成物目录；config.ts 只能是根级唯一根文件）——
  const probe: string[] = [];
  for (const rel of tree.keys()) {
    if (!rel.endsWith(".ts") || rel.startsWith("gen/")) continue;
    if (rel.endsWith(`/${CONFIG_FILE}`)) {
      throw new StoryBuildError(
        `${sourcesDirName}/${rel}——${CONFIG_FILE} 只能是根级唯一根文件，故事与模块源请放进 folders 声明的目录`,
      );
    }
    probe.push(rel);
  }

  const isCovered = (rel: string): boolean => {
    if (rel === CONFIG_FILE) return false;
    for (const dir of dirs) {
      if (rel.startsWith(`${dir}/`)) return true;
    }
    return false;
  };

  // —— E07：覆盖外 default 导出（含转发形态；纯模块无 default 不受影响；
  // 根级 config.ts 自身的 default 是布局声明，豁免）——
  const uncoveredDefaults = probe.filter(
    (rel) => rel !== CONFIG_FILE && !isCovered(rel) && classifyDefault(tree.get(rel)!) !== "none",
  );
  if (uncoveredDefaults.length > 0) {
    throw new StoryBuildError(
      [
        "以下文件含 default 导出但未被 folders 覆盖——Stories.src 全量管理构建产物，未登记的故事会在构建时被当作陈旧产物删除：",
        ...uncoveredDefaults.map((rel) => `- ${sourcesDirName}/${rel}`),
        "请把所在目录加入 config.ts 的 folders（或使用 \"*\" 兜底）。",
      ].join("\n"),
    );
  }

  // —— 覆盖域分类：故事（default 具名 function 声明）/ 模块（无 default）——
  const stories: string[] = [];
  const modules: string[] = [];
  for (const rel of probe) {
    if (rel === CONFIG_FILE) continue;
    if (!isCovered(rel)) {
      modules.push(rel);
      continue;
    }
    const verdict = classifyDefault(tree.get(rel)!);
    if (verdict === "story") {
      stories.push(rel);
    } else if (verdict === "none") {
      modules.push(rel);
    } else {
      throw new StoryBuildError(
        `${sourcesDirName}/${rel}: default 导出须是具名 function 声明（如 export default function main() {}）——匿名函数、类与表达式形态无法确定列 id`,
      );
    }
  }

  // —— start：跨探测域按精确文件名匹配，全局恰一 ——
  const hits = probe.filter((rel) => fileNameOf(rel) === config.start);
  if (hits.length === 0) {
    throw new StoryBuildError(
      stories.length === 0
        ? `${sourcesDirName}/${CONFIG_FILE}: start "${config.start}" 未匹配任何故事文件——folders 声明的目录里没有 default 导出故事函数的 .ts`
        : `${sourcesDirName}/${CONFIG_FILE}: start "${config.start}" 未匹配任何故事文件（候选：${stories.map(fileNameOf).join("、")}）`,
    );
  }
  if (hits.length > 1) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: start "${config.start}" 命中 ${hits.length} 个文件（${hits.join("、")}）——入口故事必须全局恰一，请重命名文件消歧`,
    );
  }
  const startSource = hits[0]!;
  if (classifyDefault(tree.get(startSource)!) !== "story") {
    throw new StoryBuildError(
      `${sourcesDirName}/${startSource}: start "${config.start}" 命中的文件没有 default 导出的具名故事函数`,
    );
  }
  return { stories, modules, startSource, config };
}

function fileNameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/** 编译域目录集：显式 folders ∪（含 "*" 时全树含 .ts 的目录），始终排除生成物目录前缀。 */
function collectCoveredDirs(config: StorySourceConfig, tree: ReadonlyMap<string, string>): Set<string> {
  const dirs = new Set<string>();
  for (const folder of config.folders) {
    if (folder !== "*") dirs.add(folder);
  }
  if (config.folders.includes("*")) {
    for (const rel of tree.keys()) {
      if (!rel.endsWith(".ts") || rel.startsWith("gen/") || rel === CONFIG_FILE) continue;
      const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      if (dir !== "" && !dir.startsWith("gen/")) dirs.add(dir);
    }
  }
  return dirs;
}

type DefaultVerdict = "story" | "none" | "bad";

/**
 * default 导出形态判定（AST，非文本猜测）。TS 语法两条路径：
 * - `export default function main() {}` = 直接 FunctionDeclaration 节点（default 修饰符）；
 * - `export default …`（表达式 / 匿名函数）= ExportAssignment 包装；
 * - `export { main as default }` = 具名转发（编译器侧解析函数名）。
 * 具名 function 声明 / 具名转发 → "story"；匿名、类、表达式 → "bad"（E05）；无 default → "none"。
 */
function classifyDefault(text: string): DefaultVerdict {
  const source = ts.createSourceFile("source.ts", text, ts.ScriptTarget.Latest, true);
  let verdict: DefaultVerdict = "none";
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && hasDefaultModifier(statement)) {
      return statement.name !== undefined ? "story" : "bad";
    }
    if (ts.isExportAssignment(statement)) {
      if (statement.isExportEquals) return "bad";
      verdict = isNamedFunctionDeclaration(statement.expression) ? "story" : "bad";
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    const forwardsDefault = clause.elements.some(
      (element) => element.name.text === "default" || element.propertyName?.text === "default",
    );
    if (forwardsDefault) return "story";
  }
  return verdict;
}

function hasDefaultModifier(node: ts.FunctionDeclaration): boolean {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function isNamedFunctionDeclaration(node: ts.Expression): boolean {
  return ts.isFunctionDeclaration(node) && node.name !== undefined;
}

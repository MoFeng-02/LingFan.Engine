import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isSafeFileNameSegment } from "@lingfan/engine";
import { StoryBuildError } from "./errors";

/**
 * 源工程布局声明（`Stories.src/config.ts`，根级唯一根文件）：
 * `export default { folders, start }` satisfies StorySourceConfig。
 * - `folders`：故事/模块源目录（相对 `Stories.src/`，递归扫描；`"*"` = 未显式列出的
 *   目录全部自动纳入，排除生成物目录）；
 * - `start`：入口**故事文件名**——跨全部目录按文件名匹配，全局恰一（0 或 ≥2 fail-closed）。
 */
export interface StorySourceConfig {
  readonly folders: readonly string[];
  readonly start: string;
}

/** 布局声明文件名（根级唯一根 .ts；其余 .ts 一律住 folders 声明的目录里） */
export const CONFIG_FILE = "config.ts";

/** 装载并校验布局声明（全部 fail-closed：缺文件/双根文件/装载失败/字段非法，逐条带定位）。 */
export async function loadStoryConfig(
  root: string,
  sourcesDirName: string,
): Promise<StorySourceConfig> {
  const sourcesDir = join(root, sourcesDirName);
  const configPath = join(sourcesDir, CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE} 不存在——多目录 TS 源工程需要布局声明（export default { folders, start }）：folders 声明源目录（可含 "*" 全量兜底），start 声明入口故事文件名`,
    );
  }
  assertSingleRootScript(sourcesDir, sourcesDirName);

  let mod: unknown;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (error) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE} 装载失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const config: unknown = (mod as { default?: unknown } | undefined)?.default;
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE} 的 default 导出须为对象 { folders, start }，得到 ${describe(config)}`,
    );
  }
  const record = config as Record<string, unknown>;
  const folders = parseFolders(record.folders, sourcesDirName);
  const start = parseStart(record.start, sourcesDirName);
  return { folders, start };
}

/** 根级唯一根文件守卫：根层（不递归）出现第二个 .ts 即 fail-closed。 */
function assertSingleRootScript(
  sourcesDir: string,
  sourcesDirName: string,
): void {
  const rootScripts = existsSync(sourcesDir)
    ? readdirSync(sourcesDir)
        .filter((name) => name.endsWith(".ts"))
        .sort()
    : [];
  if (rootScripts.length > 1) {
    throw new StoryBuildError(
      `${sourcesDirName}/ 根级发现 ${rootScripts.length} 个 .ts（${rootScripts.join("、")}）——根级唯一根文件是 ${CONFIG_FILE}；故事与模块源请放进 folders 声明的目录`,
    );
  }
}

/** folders 校验：非空数组，元素 = "*" 或相对 `Stories.src/` 的段级安全目录路径；禁指生成物目录。 */
function parseFolders(value: unknown, sourcesDirName: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: folders 须为非空目录名数组（可含 "*" 兜底）`,
    );
  }
  const folders = value.map((entry, index) => {
    if (entry === "*") return "*";
    if (typeof entry !== "string") {
      throw new StoryBuildError(
        `${sourcesDirName}/${CONFIG_FILE}: folders[${index}] 须为目录名字符串或 "*"，得到 ${describe(entry)}`,
      );
    }
    if (entry === "gen" || entry.startsWith("gen/")) {
      throw new StoryBuildError(
        `${sourcesDirName}/${CONFIG_FILE}: folders[${index}] "${entry}" 指向生成物目录——gen/ 由构建管理，不参与源扫描`,
      );
    }
    if (
      entry.length === 0 ||
      entry.includes("\\") ||
      !entry
        .split("/")
        .every((segment) => isSafeFileNameSegment(segment))
    ) {
      throw new StoryBuildError(
        `${sourcesDirName}/${CONFIG_FILE}: folders[${index}] "${entry}" 不是合法目录名（须为相对 ${sourcesDirName}/ 的段级安全路径）`,
      );
    }
    return entry;
  });
  return folders;
}

/** start 校验：含 .ts 的故事文件名（如 "main.ts"），不含目录——目录归属由 folders 管。 */
function parseStart(value: unknown, sourcesDirName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: start 须为入口故事文件名（如 "main.ts"）`,
    );
  }
  if (value.includes("/") || value.includes("\\")) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: start "${value}" 须为文件名不含目录——目录布局归 folders 管`,
    );
  }
  if (!value.endsWith(".ts")) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: start "${value}" 须含 .ts 扩展名（如 "main.ts"）`,
    );
  }
  return value;
}

function describe(value: unknown): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "数组"
      : typeof value;
}

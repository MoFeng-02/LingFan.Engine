/**
 * config.ts 求值（编排层唯一的 config 读取通道）：
 * `Stories.src/config.ts` 两种声明形态等价，单次求值一并取出，**双形态混用 fail-closed**：
 * - default 对象（推荐）：`export default { folders, start, version?, vars?, state? }`
 *   —— 强类型单出口（配合 `StoriesConfig` 全局类型做 IDE 补全）；
 * - named exports：`export const folders/start/version/vars/state`（兼容既有工程）。
 * 再叠加形态 B 的 define() 累积（与两种 config 形态正交）。
 * - 布局字段复用 parseFolders/parseStart/parseVersion 校验（fail-closed 带定位）；
 * - define 调用经 mergeDefineCalls 合并为纯嵌套树（同键二次定义/形状冲突一次报全部）；
 * - state 与 define 调用互斥（形态 A/B 二选一，皆缺省合法）。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_FILE,
  assertSingleRootScript,
  parseFolders,
  parseStart,
  parseVersion,
  type StorySourceConfig,
} from "../config/story-config.ts";
import {
  defaultStoriesBuildTexts,
  StoryBuildError,
  type StoriesBuildTexts,
} from "../shared/index.ts";
import { evalConstModule } from "./const-eval.ts";
import { formatConstDiagFile } from "./const-eval-pass.ts";
import { mergeDefineCalls } from "./define-merge.ts";

/** config.ts 单次求值的产物（编排层的 config 消费形态）。 */
export interface ConfigEvalOutcome {
  /** 布局声明（folders/start，已过校验） */
  readonly config: StorySourceConfig;
  /** `config.vars` 导出的键（typegen defineKeys 域贡献）；缺省 = 空数组 */
  readonly vars: readonly string[];
  /** `config.state` 导出原始树（形态 A）；缺省 = undefined（与 define 累积互斥） */
  readonly state: unknown;
  /** 形态 B define() 调用合并出的纯嵌套树；无调用 = 空对象 */
  readonly defineTree: Record<string, unknown>;
}

export async function evalConfigModule(
  root: string,
  sourcesDirName: string,
  texts: StoriesBuildTexts = defaultStoriesBuildTexts,
  timeoutMs?: number,
): Promise<ConfigEvalOutcome> {
  const sourcesDir = join(root, sourcesDirName);
  const configPath = join(sourcesDir, CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new StoryBuildError(texts.configMissing(sourcesDirName, CONFIG_FILE));
  }
  assertSingleRootScript(sourcesDir, sourcesDirName);

  const result = await evalConstModule(configPath, timeoutMs);
  if ("diags" in result) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE} 求值失败（${result.diags.length} 条）：\n${result.diags
        .map(
          (diag) =>
            `- ${formatConstDiagFile(diag.file, sourcesDir, sourcesDirName)}:${diag.line}:${diag.col} ${diag.message}`,
        )
        .join("\n")}`,
    );
  }
  const values = result.values;

  // 读取通道：default 对象优先，named exports 兜底；混用即报（契约不能有两个来源）。
  const hasDefault = "default" in values;
  const hasNamedConfig = ["folders", "start", "version", "vars", "state"].some(
    (key) => key in values,
  );
  if (hasDefault && hasNamedConfig) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: default 对象与 named exports（folders/start/version/vars/state）混用——两种声明形态二选一`,
    );
  }
  let foldersRaw: unknown;
  let startRaw: unknown;
  let versionRaw: unknown;
  let varsRaw: unknown;
  let stateRaw: unknown;
  if (hasDefault) {
    const spec = values.default;
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
      throw new StoryBuildError(
        `${sourcesDirName}/${CONFIG_FILE}: default 导出须为配置对象 { folders, start, version?, vars?, state? }，得到 ${describe(spec)}`,
      );
    }
    const obj = spec as Record<string, unknown>;
    if (!("folders" in obj) || !("start" in obj)) {
      const missing = ["folders", "start"].filter((key) => !(key in obj));
      throw new StoryBuildError(
        `${sourcesDirName}/${CONFIG_FILE}: default 配置缺少 ${missing.join("、")} 字段（folders/start 必需，version/vars/state 可缺省）`,
      );
    }
    foldersRaw = obj.folders;
    startRaw = obj.start;
    versionRaw = obj.version;
    varsRaw = "vars" in obj ? obj.vars : undefined;
    stateRaw = "state" in obj ? obj.state : undefined;
  } else {
    foldersRaw = requireExport(values, "folders", sourcesDirName);
    startRaw = requireExport(values, "start", sourcesDirName);
    versionRaw = values.version;
    varsRaw = values.vars;
    stateRaw = "state" in values ? values.state : undefined;
  }

  const folders = parseFolders(foldersRaw, sourcesDirName);
  const start = parseStart(startRaw, sourcesDirName);
  const version = parseVersion(versionRaw, sourcesDirName);

  const vars = readVarsKeySet(varsRaw, sourcesDirName);
  const hasState = stateRaw !== undefined;
  if (
    hasState &&
    (stateRaw === null ||
      typeof stateRaw !== "object" ||
      Array.isArray(stateRaw))
  ) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: state 须为键集对象（形态 A：state = { ... } as const），得到 ${describe(stateRaw)}`,
    );
  }

  const merged = mergeDefineCalls(result.defineCalls);
  if (merged.conflicts.length > 0) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: define 声明冲突（${merged.conflicts.length} 条）：\n${merged.conflicts
        .map((conflict) => `- ${conflict}`)
        .join("\n")}`,
    );
  }
  if (hasState && result.defineCalls.length > 0) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: 同时出现 state 声明与 define() 调用——形态 A/B 二选一（同文件混用即报错；两者皆缺省合法）`,
    );
  }

  return {
    config: { folders, start, version },
    vars,
    state: hasState ? stateRaw : undefined,
    defineTree: merged.tree,
  };
}

/** named exports 形态的布局必需导出（folders/start）；缺省 = fail-closed 并说明契约。 */
function requireExport(
  values: Record<string, unknown>,
  name: string,
  sourcesDirName: string,
): unknown {
  if (!(name in values)) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: 缺少 ${name} 导出（config.ts 契约：default 对象或 folders/start named exports 二选一，vars/state/version 可缺省）`,
    );
  }
  return values[name];
}

/** vars 键集提取（键 = typegen defineKeys 域贡献；值文法不在此校验，与旧图谱扫描同宽）。 */
function readVarsKeySet(
  varsRaw: unknown,
  sourcesDirName: string,
): readonly string[] {
  if (varsRaw === undefined) return [];
  const spec = varsRaw;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: vars 须为键集对象（defineVars({ ... }) 的返回值），得到 ${describe(spec)}`,
    );
  }
  return Object.keys(spec as Record<string, unknown>);
}

function describe(value: unknown): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "数组"
      : typeof value;
}

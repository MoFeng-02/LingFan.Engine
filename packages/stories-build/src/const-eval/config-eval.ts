/**
 * config.ts 求值（编排层唯一的 config 读取通道）：
 * `Stories.src/config.ts` 以 named exports 声明五件事——folders/start（布局，必需）、
 * vars/state（变量键域与状态初始树，可缺省）、version（故事版本，可缺省），
 * 再叠加形态 B 的 define() 累积。
 * 本段用 evalConstModule 单次求值把导出与 define 调用一并取出：
 * - 布局字段复用 parseFolders/parseStart/parseVersion 校验（fail-closed 带定位）；
 * - define 调用经 mergeDefineCalls 合并为纯嵌套树（同键二次定义/形状冲突一次报全部）；
 * - state 导出与 define 调用互斥（形态 A/B 二选一，皆缺省合法）。
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

  const folders = parseFolders(
    requireExport(values, "folders", sourcesDirName),
    sourcesDirName,
  );
  const start = parseStart(
    requireExport(values, "start", sourcesDirName),
    sourcesDirName,
  );
  const version = parseVersion(values.version, sourcesDirName);

  const vars = readVarsKeySet(values, sourcesDirName);
  const hasState = "state" in values;
  const state = hasState ? values.state : undefined;
  if (
    hasState &&
    (state === null || typeof state !== "object" || Array.isArray(state))
  ) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: state 导出须为键集对象（形态 A：export const state = { ... } as const），得到 ${describe(state)}`,
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
      `${sourcesDirName}/${CONFIG_FILE}: 同时出现 state 导出与 define() 调用——形态 A/B 二选一（同文件混用即报错；两者皆缺省合法）`,
    );
  }

  return { config: { folders, start, version }, vars, state, defineTree: merged.tree };
}

/** 布局必需导出（folders/start）；缺省 = fail-closed 并说明契约。 */
function requireExport(
  values: Record<string, unknown>,
  name: string,
  sourcesDirName: string,
): unknown {
  if (!(name in values)) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: 缺少 ${name} 导出（config.ts 契约：folders/start 必需，vars/state 可缺省）`,
    );
  }
  return values[name];
}

/** vars 键集提取（键 = typegen defineKeys 域贡献；值文法不在此校验，与旧图谱扫描同宽）。 */
function readVarsKeySet(
  values: Record<string, unknown>,
  sourcesDirName: string,
): readonly string[] {
  if (!("vars" in values)) return [];
  const spec = values.vars;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    throw new StoryBuildError(
      `${sourcesDirName}/${CONFIG_FILE}: vars 导出须为键集对象（export const vars = defineVars({ ... })），得到 ${describe(spec)}`,
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

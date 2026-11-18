/**
 * i18n CLI · 参数解析（纯函数）。
 *
 * 形态对齐 stories-build 的 CLI 解析器：`--flag=value` 与 `--flag value` 都收，
 * 缺值报参数名并 fail-closed；未知选项/未知子命令/多余位置参数一律抛错（防拼写错被静默）。
 * 本模块不碰 Node API：环境变量与工作目录由调用方注入（`I18nArgsContext`），
 * 工程根三级回落 = 位置参数 → DSH_I18N_ROOT → 进程工作目录；返回的 root 是**未 resolve
 * 的原始路径**，绝对化与读盘归 IO 层。抛出的 Error 由 CLI 入口映射为退出码 2（参数错误）。
 */

import type { SkeletonLayout, SkeletonPlaceholder } from "../i18n/index.ts";

export type I18nCommand = "scan" | "skeleton" | "report" | "check";

/** check 的失败判据：missing = 缺译文；unused = 孤儿键；any = 缺译/孤儿/未标记静态文案任一 */
export type I18nFailOn = "missing" | "unused" | "any";

export interface I18nCliArgs {
  command: I18nCommand;
  /** 工程根（三级回落结果；未 resolve，绝对化归 IO 层） */
  root: string;
  layout: SkeletonLayout;
  /** 语言代码；skeleton/report 必填，scan/check 可选（缺省 = 全部语言，归编排层解释） */
  lang?: string;
  placeholder: SkeletonPlaceholder;
  /** 机器可读输出（CI 消费） */
  json: boolean;
  failOn: I18nFailOn;
  /** 删除无源孤儿键（破坏性，默认关；开启时编排层必须逐条列出被删键） */
  prune: boolean;
  /** 扫描收全部非空字面量（默认只收含 CJK） */
  all: boolean;
  /**
   * 宿主 t() 别名清单（显式配置，不隐式猜测）：`--functions=t,tr` 逗号分隔。
   * 缺省 = 未指定 ⇒ IO 层回落工程清单 `i18n.functions`，再回落 ["t"]。
   * 空段原样保留（含空名 fail-closed，判定在 ast-scan 唯一文案源）。
   */
  functions?: readonly string[];
  scanDir?: string;
  storiesDir?: string;
  resourcesDir?: string;
}

export interface I18nArgsContext {
  /** DSH_I18N_ROOT 的值（调用方从 process.env 读取后注入） */
  envRoot?: string;
  /** 进程工作目录（调用方注入） */
  cwd: string;
}

const COMMANDS: readonly I18nCommand[] = ["scan", "skeleton", "report", "check"];
const LAYOUTS: readonly SkeletonLayout[] = ["single", "main", "per-story"];
const PLACEHOLDERS: readonly SkeletonPlaceholder[] = ["original", "empty"];
const FAIL_ONS: readonly I18nFailOn[] = ["missing", "unused", "any"];

const VALUE_FLAGS = [
  ["--layout", "layout"],
  ["--lang", "lang"],
  ["--placeholder", "placeholder"],
  ["--fail-on", "failOn"],
  ["--functions", "functions"],
  ["--scan-dir", "scanDir"],
  ["--stories-dir", "storiesDir"],
  ["--resources-dir", "resourcesDir"],
] as const;

const BOOL_FLAGS = [
  ["--json", "json"],
  ["--prune", "prune"],
  ["--all", "all"],
] as const;

type ValueKey = (typeof VALUE_FLAGS)[number][1];
type BoolKey = (typeof BOOL_FLAGS)[number][1];

/** 枚举值校验：命中返回原值，否则报参数名与合法取值（fail-closed） */
function oneOf<T extends string>(
  flag: string,
  value: string,
  allowed: readonly T[],
): T {
  const hit = allowed.find((candidate) => candidate === value);
  if (hit === undefined) {
    throw new Error(`${flag} 取值非法：${value}（可用：${allowed.join("|")}）`);
  }
  return hit;
}

/**
 * 解析 `lingfan-i18n <子命令> [工程根] [选项]` 的 argv（不含 node/脚本名）。
 * 任何参数错误抛 Error（消息含参数名）；成功返回归一化后的完整参数。
 */
export function parseI18nArgs(
  argv: readonly string[],
  context: I18nArgsContext,
): I18nCliArgs {
  const head = argv[0];
  const command = COMMANDS.find((candidate) => candidate === head);
  if (command === undefined) {
    throw new Error(
      head === undefined
        ? `缺少子命令（可用：${COMMANDS.join("|")}）`
        : `未知子命令：${head}（可用：${COMMANDS.join("|")}）`,
    );
  }
  const values: Partial<Record<ValueKey, string>> = {};
  const flags: Partial<Record<BoolKey, boolean>> = {};
  let rootPositional: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const valueMatch = VALUE_FLAGS.find(
      ([flag]) => arg === flag || arg.startsWith(`${flag}=`),
    );
    if (valueMatch !== undefined) {
      const [flag, key] = valueMatch;
      const inline = arg.startsWith(`${flag}=`) ? arg.slice(flag.length + 1) : "";
      const value = inline !== "" ? inline : argv[++index];
      if (value === undefined || value === "") {
        throw new Error(`${flag} 需要一个值（如 ${flag}=<值>）`);
      }
      values[key] = value;
      continue;
    }
    const boolMatch = BOOL_FLAGS.find(([flag]) => arg === flag);
    if (boolMatch !== undefined) {
      flags[boolMatch[1]] = true;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`未知选项：${arg}`);
    }
    if (rootPositional !== undefined) {
      throw new Error(`只接受一个工程根位置参数（已有 ${rootPositional}，又见 ${arg}）`);
    }
    rootPositional = arg;
  }
  const { envRoot, cwd } = context;
  const root =
    rootPositional ?? (envRoot !== undefined && envRoot !== "" ? envRoot : cwd);
  const lang = values.lang;
  if ((command === "skeleton" || command === "report") && lang === undefined) {
    throw new Error(`${command} 需要 --lang=<语言代码>`);
  }
  return {
    command,
    root,
    layout:
      values.layout === undefined
        ? "per-story"
        : oneOf("--layout", values.layout, LAYOUTS),
    ...(lang === undefined ? {} : { lang }),
    placeholder:
      values.placeholder === undefined
        ? "original"
        : oneOf("--placeholder", values.placeholder, PLACEHOLDERS),
    json: flags.json === true,
    failOn:
      values.failOn === undefined
        ? "missing"
        : oneOf("--fail-on", values.failOn, FAIL_ONS),
    prune: flags.prune === true,
    all: flags.all === true,
    ...(values.functions === undefined
      ? {}
      : { functions: values.functions.split(",") }),
    ...(values.scanDir === undefined ? {} : { scanDir: values.scanDir }),
    ...(values.storiesDir === undefined ? {} : { storiesDir: values.storiesDir }),
    ...(values.resourcesDir === undefined
      ? {}
      : { resourcesDir: values.resourcesDir }),
  };
}
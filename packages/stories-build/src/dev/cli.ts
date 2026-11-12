/**
 * 直达命令的呈现层：把参数与清单的结果转成「给用户看的文字 + 退出码」。
 *
 * 这一层只做拼装与措辞，不重新判定事实——事实由参数解析与清单扫描给出。
 * 把结果做成返回值而不是直接打印，是为了让开发脚本能自己决定怎么输出，
 * 也让用例不必捕获进程级副作用。
 */
import { parseDevArgs, STORY_NAME_FLAG } from "./args.ts";
import type { DevArgsOptions } from "./args.ts";
import { listDevEntries, resolveDevTarget } from "./entries.ts";
import { StoryBuildError } from "../shared/index.ts";

/** 命令结果：退出码 + 两路输出 + 直达目标 + 要透传给下游的选项 */
export interface DevCommandResult {
  /** 进程退出码 */
  readonly exitCode: number;
  /** 标准输出 */
  readonly stdout: string;
  /** 标准错误 */
  readonly stderr: string;
  /** 直达目标列 id；undefined = 不是直达 */
  readonly entryId?: string;
  /** 要原样透传给下游工具的选项 */
  readonly passthrough: readonly string[];
  /**
   * 命令是否已终结：帮助、清单与失败都到此为止，调用方不必再启动下游工具。
   * 普通启动（没有章节参数）是 false——此时才该把开发服务器拉起来。
   */
  readonly done: boolean;
}

/** 帮助文本：写明各形态的写法与取值为列 id */
export const DEV_HELP_TEXT = [
  `用法：<包管理器> dev ${STORY_NAME_FLAG} <列 id>`,
  "",
  `取值是列 id（不是文件名），例如 ${STORY_NAME_FLAG} inn。`,
  "",
  "各包管理器的传参写法：",
  `  npm   run dev -- ${STORY_NAME_FLAG} inn`,
  `  pnpm  dev ${STORY_NAME_FLAG} inn`,
  `  yarn  dev ${STORY_NAME_FLAG} inn`,
  `  bun   run dev ${STORY_NAME_FLAG} inn`,
  "",
  "选项：",
  `  ${STORY_NAME_FLAG} <列 id>   直达指定列（跳过启动页）`,
  "  --list-entries      列出可直达的列后退出",
  "  -h, --help          显示本帮助后退出",
].join("\n");

/** 列出可用列：按清单顺序逐行列出「列 id  产物文件」 */
function formatEntries(
  entries: readonly { id: string; sourcePath: string }[],
): string {
  if (entries.length === 0) return "（没有可直达的列）";
  return entries.map((entry) => `${entry.id}\t${entry.sourcePath}`).join("\n");
}

/** 未知列：报出可用列，便于直接改写参数 */
function formatUnknown(id: string, available: readonly string[]): string {
  const hint =
    available.length === 0 ? "" : `\n可用列：${available.join("、")}`;
  return `未知章节：${id}${hint}`;
}

/**
 * 跑一次直达命令。
 *
 * @param argv 命令行参数（不含可执行文件名）
 * @param projectRoot 工程根（其下有资源根）
 * @param options 外来选项的处置方式（透传还是报错）
 */
export function runDevCommand(
  argv: readonly string[],
  projectRoot: string,
  options: DevArgsOptions = {},
): DevCommandResult {
  let args;
  try {
    args = parseDevArgs(argv, options);
  } catch (error: unknown) {
    if (error instanceof StoryBuildError) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error.message}\n\n${DEV_HELP_TEXT}`,
        passthrough: [],
        done: true,
      };
    }
    throw error;
  }
  if (args.help) {
    return {
      exitCode: 0,
      stdout: `${DEV_HELP_TEXT}\n`,
      stderr: "",
      passthrough: args.passthrough,
      done: true,
    };
  }
  if (args.storyName === undefined && !args.listEntries) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      passthrough: args.passthrough,
      done: false,
    };
  }
  let entries;
  try {
    entries = listDevEntries(projectRoot);
  } catch (error: unknown) {
    if (error instanceof StoryBuildError) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${error.message}\n`,
        passthrough: args.passthrough,
        done: true,
      };
    }
    throw error;
  }
  if (args.listEntries) {
    return {
      exitCode: 0,
      stdout: `${formatEntries(entries.entries)}\n`,
      stderr: "",
      passthrough: args.passthrough,
      done: true,
    };
  }
  const target = resolveDevTarget(entries, args.storyName ?? "");
  if (target.ok) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      entryId: target.entry.id,
      passthrough: args.passthrough,
      done: false,
    };
  }
  if (target.reason === "ambiguous") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `章节 id 歧义：${target.id}\n候选文件：${target.candidates.join("、")}\n`,
      passthrough: args.passthrough,
      done: true,
    };
  }
  const available = entries.entries.map((entry) => entry.id);
  return {
    exitCode: 1,
    stdout: "",
    stderr: `${formatUnknown(target.id, available)}\n`,
    passthrough: args.passthrough,
    done: true,
  };
}

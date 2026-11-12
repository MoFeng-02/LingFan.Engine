/**
 * 直达参数解析：把命令行拆成「目标列 id / 查询开关 / 透传选项」三部分。
 *
 * 参数形态（`--flag value`、`--flag=value`、位置参数）在各家包管理器透传时并不一致，
 * 因此解析器只认语义、不问形态从哪来：裸 `--` 一律跳过（它是分隔符，不是参数），
 * 位置参数当作目标列 id，未知选项按约定处置——放行时收进透传列表，不放行时直接报错。
 * 拼错的选项若被静默放行，报错会指向下游工具，排查方向被带偏。
 *
 * `--mode` 是唯一无条件放行的外来选项：桌面开发链的前置命令会经由开发脚本传下它，
 * 它是链上自己发的，不是拼错的，故原样透传给下游。
 */
import { StoryBuildError } from "../shared/index.ts";

/** 直达参数名：取值是列 id（`story.columns[].id`），不是文件名 */
export const STORY_NAME_FLAG = "--story-name";

/** 放行并原样透传给下游工具的选项：下游开发服务器的构建模式 */
const MODE_FLAG = "--mode";

/** 外来选项的处置方式 */
export interface DevArgsOptions {
  /**
   * 不属于直达参数的选项怎么处置：
   * - `error`：直接报错退出（开发服务器链路用它，避免把拼错的选项带下去）；
   * - `passthrough`：收进透传列表交给下游（工具链链路用它，下游自己认这些选项）。
   */
  readonly foreign?: "error" | "passthrough";
}

/** 解析结果：普通启动（无章节）或直达某列 */
export interface DevArgs {
  /** 目标列 id；undefined = 普通启动 */
  readonly storyName?: string;
  /** 只列出可用列后退出 */
  readonly listEntries: boolean;
  /** 只显示帮助后退出 */
  readonly help: boolean;
  /** 要原样透传给下游工具的选项 */
  readonly passthrough: readonly string[];
}

/** 选项的下一个 token 是否可当作取值：`-` 开头的是另一个选项，不是取值 */
function isValue(token: string | undefined): token is string {
  return token !== undefined && token !== "" && !token.startsWith("-");
}

/**
 * 拆命令行：章节参数进 `storyName`，`--list-entries` / `--help` 进各自的开关，
 * `--mode` 进 `passthrough`（原样带给下游），其余 `-` 开头的选项按 `options.foreign` 处置。
 *
 * 位置参数至多一个：第二个位置参数是多余的，报错比默默覆盖更安全。
 *
 * @param argv 命令行参数（不含可执行文件名）
 * @param options 外来选项的处置方式
 */
export function parseDevArgs(
  argv: readonly string[],
  options: DevArgsOptions = {},
): DevArgs {
  const foreign = options.foreign ?? "error";
  let storyName: string | undefined;
  let listEntries = false;
  let help = false;
  const passthrough: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") continue;
    if (arg === STORY_NAME_FLAG) {
      const value = argv[index + 1];
      if (!isValue(value)) {
        throw new StoryBuildError(
          `${STORY_NAME_FLAG} 需要一个列 id 作为取值（如 ${STORY_NAME_FLAG} inn）`,
        );
      }
      storyName = value;
      index += 1;
      continue;
    }
    if (arg.startsWith(`${STORY_NAME_FLAG}=`)) {
      const value = arg.slice(STORY_NAME_FLAG.length + 1);
      if (value === "") {
        throw new StoryBuildError(
          `${STORY_NAME_FLAG} 需要一个列 id 作为取值（如 ${STORY_NAME_FLAG}=inn）`,
        );
      }
      storyName = value;
      continue;
    }
    if (arg === "--list-entries") {
      listEntries = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === MODE_FLAG) {
      const value = argv[index + 1];
      if (value === undefined || value === "") {
        throw new StoryBuildError(
          `${MODE_FLAG} 需要一个取值（如 ${MODE_FLAG} tauri）`,
        );
      }
      passthrough.push(arg, value);
      index += 1;
      continue;
    }
    if (arg.startsWith(`${MODE_FLAG}=`)) {
      const value = arg.slice(MODE_FLAG.length + 1);
      if (value === "") {
        throw new StoryBuildError(
          `${MODE_FLAG} 需要一个取值（如 ${MODE_FLAG}=tauri）`,
        );
      }
      passthrough.push(`${MODE_FLAG}=${value}`);
      continue;
    }
    if (arg.startsWith("-")) {
      if (foreign === "error") {
        throw new StoryBuildError(`未知选项：${arg}`);
      }
      passthrough.push(arg);
      continue;
    }
    if (storyName !== undefined) {
      throw new StoryBuildError(`多余的参数：${arg}`);
    }
    storyName = arg;
  }
  return { storyName, listEntries, help, passthrough };
}

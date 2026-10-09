/**
 * 单命令行语句的分发骨架：建上下文、按 op 族转交、兜底报「暂不支持」。
 * 各族的判定与文案都在 statement/ 下的族文件里，这里只负责路由。
 *
 * 注意：本文件与同名的 `statement/` 目录并存——模块解析**文件优先**，
 * 故 `./statement` 恒指本文件；请勿在 `statement/` 下加 `index.ts`。
 */
import { parseDialogStatement } from "./statement/dialog";
import { parseFlowStatement } from "./statement/flow";
import { parseVariablesStatement } from "./statement/variables";
import { parseCollectionsStatement } from "./statement/collections";
import { parseSaveStatement } from "./statement/save";
import { parseMediaStatement } from "./statement/media";
import { parsePresentStatement } from "./statement/present";
import { unquote } from "../lexer";
import type { StoryCommand } from "../../../contracts";
import type { StatementContext } from "./state";

/**
 * 单条命令行语句的读向入口：把一行已切词的语句解析成命令对象。
 *
 * 输入：`op`（首词）、`rest`（首词之后的行内剩余文本）、`tokens`（`rest` 按引号规则切好的参数词表）、
 * `at`（定位前缀，形如 `文件名:行号`，用于拼接报错）、`issues`（外部错误收集器）、可选 `warnings`（警告级收集器）。
 * 产出：对应的 `StoryCommand`；语句本身合法但语义暂未生效时（如无参 `pause`）除命令外还向警告池记一条提示。
 * 失败表现：不抛异常，一律返回 `null` 并把原因推入 `issues`（缺参、类型不符、未知参数、未知 op 等）；
 * 调用方按 `issues` 非空整次拒绝。分发按 op 族转交 `statement/` 下的族文件，本函数只负责建上下文与路由。
 */
export function parseSimpleStatement(
  op: string,
  rest: string,
  tokens: string[],
  at: string,
  issues: string[],
  /** 警告级问题（不阻塞解析）；缺省 = 无处可投 */
  warnings?: string[],
): StoryCommand | null {
  const fail = (message: string): null => {
    issues.push(`${at}: ${message}`);
    return null;
  };
  const quoted = (index: number): string => unquote(tokens[index] ?? "");
  const ctx: StatementContext = { op, rest, tokens, at, issues, warnings, fail, quoted };
  switch (op) {
    case "say":
    case "nvl":
    case "notify":
    case "input":
    case "wait":
    case "pause":
    case "assert":
    case "guard":
      return parseDialogStatement(ctx);
    case "jump":
    case "navigate":
    case "call":
    case "return":
    case "break":
    case "continue":
    case "minigame":
    case "character":
    case "scene":
      return parseFlowStatement(ctx);
    case "set":
    case "define":
    case "let":
    case "local":
    case "undef":
      return parseVariablesStatement(ctx);
    case "array":
    case "array_push":
    case "array_pop":
    case "dict":
    case "dict_set":
    case "random":
      return parseCollectionsStatement(ctx);
    case "save":
    case "load":
    case "auto_save":
    case "save_delete":
      return parseSaveStatement(ctx);
    case "bgm":
    case "se":
    case "ambient":
    case "voice":
    case "stop_bgm":
    case "stop_ambient":
    case "stop_voice":
    case "video":
    case "cutscene":
    case "seek_video":
    case "pause_video":
    case "resume_video":
    case "stop_video":
    case "video_skipable":
      return parseMediaStatement(ctx);
    case "show":
    case "hide":
    case "background":
    case "bg_switch":
    case "zindex":
    case "style":
    case "window":
    case "animate":
    case "animate_block":
    case "transition":
    case "shake":
    case "text_typewriter":
      return parsePresentStatement(ctx);
    default:
      return fail(`文本投影暂不支持的语句：${op}`);
  }
}

/**
 * 命令文本投影的分发骨架：建上下文、按 op 族转交、兜底走扩展投影或 fail-closed。
 * 各族的判定与文案都在 command/ 下的族文件里，这里只负责路由。
 *
 * 注意：本文件与同名的 `command/` 目录并存——模块解析**文件优先**，
 * 故 `./command` 恒指本文件；请勿在 `command/` 下加 `index.ts`。
 */
import { generateDialogCommand } from "./command/dialog";
import { generateFlowCommand } from "./command/flow";
import { generateVariablesCommand } from "./command/variables";
import { generateCollectionsCommand } from "./command/collections";
import { generateSaveCommand } from "./command/save";
import { generateMediaCommand } from "./command/media";
import { generateBlocksCommand } from "./command/blocks";
import { generatePresentCommand } from "./command/present";
import { tryProjectToText } from "./body";
import { TextFormatError } from "../error";
import type { CustomOpProjections, StoryCommand } from "../../../contracts";
import type { GenerateContext } from "./context";

/**
 * 单条命令的写向入口：把命令对象投影成一行文本并追加到输出缓冲。
 *
 * 输入：`cmd`（要投影的命令）、`pad`（本行缩进前缀，块体逐层加深）、
 * `out`（输出缓冲，行直接推入，不留空行）、可选 `projections`（自定义 op 的文本投影表）。
 * 产出：无返回值，结果通过 `out` 交付；自定义 op 命中 `projections` 时用其投影结果，空行视为不可投影。
 * 失败表现：抛 `TextFormatError`（op 无文本投影、字段缺字符串等不可投影情形）——**不是**静默跳过，
 * 由上层 `tolerant` 按命令粒度捕获后降级为 issue，从而使整棵树的其余部分照常输出。
 */
export function generateCommand(
  cmd: StoryCommand,
  pad: string,
  out: string[],
  projections?: CustomOpProjections,
): void {
  const ctx: GenerateContext = { pad, out, projections };
  switch (cmd.op) {
    case "say":
    case "notify":
    case "wait":
    case "pause":
    case "input":
    case "nvl":
    case "assert":
    case "guard":
      generateDialogCommand(cmd, ctx);
      return;
    case "jump":
    case "navigate":
    case "call":
    case "return":
    case "break":
    case "continue":
    case "minigame":
    case "character":
      generateFlowCommand(cmd, ctx);
      return;
    case "set":
    case "define":
    case "let":
    case "local":
    case "undef":
      generateVariablesCommand(cmd, ctx);
      return;
    case "array":
    case "array_push":
    case "array_pop":
    case "dict":
    case "dict_set":
    case "random":
      generateCollectionsCommand(cmd, ctx);
      return;
    case "save":
    case "load":
    case "auto_save":
    case "save_delete":
      generateSaveCommand(cmd, ctx);
      return;
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
      generateMediaCommand(cmd, ctx);
      return;
    case "if":
    case "while":
    case "for":
    case "foreach":
    case "switch":
    case "menu":
    case "func":
      generateBlocksCommand(cmd, ctx);
      return;
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
      generatePresentCommand(cmd, ctx);
      return;
    default: {
      // 扩展投影：声明了 toText 的自定义 op 交给投影器；否则 fail-closed（不静默）
      const toText = projections?.get(cmd.op)?.toText;
      if (toText !== undefined) {
        const line = tryProjectToText(toText, cmd);
        if (line !== null) {
          out.push(`${pad}${line}`);
          return;
        }
        throw new TextFormatError([
          `自定义 op「${cmd.op}」文本投影失败（toText 返回 null 或抛出）`,
        ]);
      }
      // 未支持文本投影的 op：fail-closed（不静默）
      throw new TextFormatError([`op "${cmd.op}" 暂无文本投影`]);
    }
  }
}

/** save 族的文本投影。 */
import { quoteForText } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

/**
 * 投影本族的 op 行（`save` `load` `auto_save` `save_delete`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（缺字符串、字典字段缺失等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 */
export function generateSaveCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "save":
      out.push(
        cmd.title === undefined
          ? `${pad}save ${quoteForText(cmd.slot as string)}`
          : `${pad}save ${quoteForText(cmd.slot as string)} title ${quoteForText(cmd.title as string)}`,
      );
      return;
    case "load":
      out.push(`${pad}load ${quoteForText(cmd.slot as string)}`);
      return;
    case "auto_save":
      out.push(`${pad}auto_save ${cmd.enabled === true ? "true" : "false"}`);
      return;
    case "save_delete":
      out.push(`${pad}save_delete ${quoteForText(cmd.slot as string)}`);
      return;
  }
}

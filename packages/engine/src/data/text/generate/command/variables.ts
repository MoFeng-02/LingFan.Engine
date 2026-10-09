/** variables 族的文本投影。 */
import { quoteForText, generateValue } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

/**
 * 投影本族的 op 行（`set` `define` `let` `local` `undef`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（缺字符串、字典字段缺失等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 */
export function generateVariablesCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "set":
    case "define":
    case "let":
    case "local":
      out.push(
        `${pad}${cmd.op} ${quoteForText(cmd.key as string)} ${generateValue(cmd.value)}`,
      );
      return;
    case "undef":
      out.push(`${pad}undef ${quoteForText(cmd.key as string)}`);
      return;
  }
}

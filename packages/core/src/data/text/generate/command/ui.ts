/** ui 族的文本投影。 */
import { generateDictLiteral } from "../../literals.ts";
import type { StoryCommand } from "../../../../contracts/index.ts";
import type { GenerateContext } from "../context.ts";

/**
 * 投影本族的 op 行（`mount`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（`props` 不是对象等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 *
 * 形态：`mount <UI 名> <true|false> [props={…}]`。UI 名是短标识（不含引号也不含空白），
 * 显隐写成字面 `true` / `false`——不写「切换」，文本形态与状态语义一样确定。
 */
export function generateUiCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "mount": {
      let line = `${pad}mount ${cmd.name as string} ${cmd.visible === true ? "true" : "false"}`;
      if (cmd.props !== undefined)
        line += ` props=${generateDictLiteral(cmd.props as Record<string, unknown>)}`;
      out.push(line);
      return;
    }
  }
}

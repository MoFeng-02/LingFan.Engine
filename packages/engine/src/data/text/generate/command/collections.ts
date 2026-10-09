/** collections 族的文本投影。 */
import { quoteForText, generateValue, generateDictLiteral } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

/**
 * 投影本族的 op 行（`array` `array_push` `array_pop` `dict` `dict_set` `random`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（缺字符串、字典字段缺失等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 */
export function generateCollectionsCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "array":
      out.push(
        `${pad}array ${quoteForText(cmd.key as string)} [${(cmd.items as unknown[]).map(generateValue).join(", ")}]`,
      );
      return;
    case "array_push":
      out.push(
        `${pad}array_push ${quoteForText(cmd.key as string)} ${generateValue(cmd.value)}`,
      );
      return;
    case "array_pop":
      out.push(`${pad}array_pop ${quoteForText(cmd.key as string)}`);
      return;
    case "dict":
      out.push(
        `${pad}dict ${quoteForText(cmd.key as string)} ${generateDictLiteral(cmd.value as Record<string, unknown>)}`,
      );
      return;
    case "dict_set":
      out.push(
        `${pad}dict_set ${quoteForText(cmd.key as string)} ${quoteForText(cmd.field as string)} ${generateValue(cmd.value)}`,
      );
      return;
    case "random":
      out.push(
        `${pad}random seed=${cmd.seed} min=${(cmd.range as number[])[0]} max=${(cmd.range as number[])[1]} var=${quoteForText(cmd.var as string)}`,
      );
      return;
  }
}

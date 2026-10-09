/** blocks 族的文本投影。 */
import { generateBody } from "../body";
import { quoteForText, generateValue, instanceZText } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

/**
 * 投影本族的 op 行（`if` `while` `for` `foreach` `switch` `menu` `func`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（缺字符串、字典字段缺失等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 */
export function generateBlocksCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out, projections } = c;
  switch (cmd.op) {
    case "if": {
      out.push(`${pad}if ${cmd.cond}`);
      generateBody(cmd.then as StoryCommand[], pad, out, projections);
      for (const elif of (cmd.elif ?? []) as Array<{
        cond: string;
        then: StoryCommand[];
      }>) {
        out.push(`${pad}else if ${elif.cond}`);
        generateBody(elif.then, pad, out, projections);
      }
      if (cmd.else !== undefined && (cmd.else as StoryCommand[]).length > 0) {
        out.push(`${pad}else`);
        generateBody(cmd.else as StoryCommand[], pad, out, projections);
      }
      return;
    }
    case "while":
      out.push(`${pad}while ${cmd.cond}`);
      generateBody(cmd.body as StoryCommand[], pad, out, projections);
      return;
    case "for":
      out.push(`${pad}for ${quoteForText(cmd.var as string)} in ${cmd.in}`);
      generateBody(cmd.body as StoryCommand[], pad, out, projections);
      return;
    case "foreach":
      out.push(
        `${pad}foreach ${quoteForText(cmd.var as string)} in ${quoteForText(cmd.key as string)}`,
      );
      generateBody(cmd.body as StoryCommand[], pad, out, projections);
      return;
    case "switch":
      out.push(`${pad}switch ${cmd.on}`);
      for (const c of cmd.cases as Array<{
        value: unknown;
        body: StoryCommand[];
      }>) {
        out.push(`${pad}  case ${generateValue(c.value)}`);
        generateBody(c.body, `${pad}  `, out, projections);
      }
      if (
        cmd.default !== undefined &&
        (cmd.default as StoryCommand[]).length > 0
      ) {
        out.push(`${pad}  default`);
        generateBody(cmd.default as StoryCommand[], `${pad}  `, out, projections);
      }
      return;
    case "menu":
      out.push(
        `${pad}menu ${quoteForText(cmd.prompt as string)}${instanceZText(cmd)}`,
      );
      for (const o of cmd.options as Array<{ text: string; target: string }>) {
        out.push(`${pad}  ${quoteForText(o.text)} -> ${o.target}`);
      }
      return;
    case "func":
      out.push(
        `${pad}func ${cmd.name}(${(cmd.params as string[]).join(", ")})`,
      );
      generateBody(cmd.body as StoryCommand[], pad, out, projections);
      return;
  }
}

/** variables 族的文本投影。 */
import { quoteForText, generateValue } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

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

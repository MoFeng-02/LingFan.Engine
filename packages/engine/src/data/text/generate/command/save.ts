/** save 族的文本投影。 */
import { quoteForText } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

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

/** collections 族的文本投影。 */
import { quoteForText, generateValue, generateDictLiteral } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

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

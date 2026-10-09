/** flow 族的文本投影。 */
import { quoteForText, generateValue, generateDictLiteral, instanceZText } from "../../literals";
import { StoryCommand, CharacterDef } from "../../../../contracts";
import { GenerateContext } from "../context";

export function generateFlowCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "jump":
      out.push(`${pad}jump ${cmd.target}`);
      return;
    case "navigate":
      out.push(
        cmd.scene === undefined
          ? `${pad}navigate ${quoteForText(cmd.path as string)}`
          : `${pad}navigate ${quoteForText(cmd.path as string)} scene ${quoteForText(cmd.scene as string)}`,
      );
      return;
    case "call":
      out.push(`${pad}call ${cmd.target}`);
      return;
    case "return":
      out.push(
        cmd.value === undefined
          ? `${pad}return`
          : `${pad}return ${generateValue(cmd.value)}`,
      );
      return;
    case "break":
      out.push(`${pad}break`);
      return;
    case "continue":
      out.push(`${pad}continue`);
      return;
    case "minigame": {
      // reward 键值数组以字典字面量投影（键序 = 条目序，与解析端 Object.entries 对称）
      let line = `${pad}minigame ${quoteForText(cmd.game as string)}`;
      if (cmd.on_success !== undefined)
        line += ` on_success ${quoteForText(cmd.on_success as string)}`;
      if (cmd.on_fail !== undefined)
        line += ` on_fail ${quoteForText(cmd.on_fail as string)}`;
      if (cmd.config !== undefined)
        line += ` config ${generateDictLiteral(cmd.config as Record<string, unknown>)}`;
      if (cmd.reward !== undefined) {
        const dict: Record<string, unknown> = {};
        for (const entry of cmd.reward as Array<{
          key: string;
          value: unknown;
        }>) {
          dict[entry.key] = entry.value;
        }
        line += ` reward ${generateDictLiteral(dict)}`;
      }
      line += instanceZText(cmd);
      out.push(line);
      return;
    }
    case "character": {
      let line = `${pad}character ${quoteForText(cmd.key as string)}`;
      const def = cmd as unknown as CharacterDef;
      if (def.name !== undefined) line += ` name=${quoteForText(def.name)}`;
      if (def.color !== undefined) line += ` color=${quoteForText(def.color)}`;
      if (def.size !== undefined) line += ` size=${quoteForText(def.size)}`;
      if (def.textColor !== undefined)
        line += ` textColor=${quoteForText(def.textColor)}`;
      if (def.screen !== undefined)
        line += ` screen=${quoteForText(def.screen)}`;
      if (def.font !== undefined) line += ` font=${quoteForText(def.font)}`;
      out.push(line);
      return;
    }
  }
}

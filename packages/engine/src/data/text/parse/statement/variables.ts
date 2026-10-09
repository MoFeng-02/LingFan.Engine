/** variables 族的读向解析。 */
import { parseValueLiteral } from "../../literals";
import { unquote } from "../../lexer";
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

export function parseVariablesStatement(c: StatementContext): StoryCommand | null {
  const { op, rest, tokens, fail, quoted } = c;
  switch (op) {
    case "set":
    case "define":
    case "let":
    case "local": {
      const keyStart = rest.indexOf('"');
      const keyEnd = keyStart < 0 ? -1 : rest.indexOf('"', keyStart + 1);
      if (tokens.length < 1 || keyStart < 0 || keyEnd < 0) {
        return fail(`${op} 文法：${op} "key" 值`);
      }
      const key = unquote(rest.slice(keyStart, keyEnd + 1));
      const value = rest.slice(keyEnd + 1).trim();
      if (key === "" || value === "") return fail(`${op} 需要 key 与 value`);
      return { op, key, value: parseValueLiteral(value) } as StoryCommand;
    }
    case "undef":
      if (tokens.length < 1) return fail("undef 需要 key");
      return { op: "undef", key: quoted(0) } as StoryCommand;
  }
  return null;
}

/** variables 族的读向解析。 */
import { parseValueLiteral } from "../../literals";
import { unquote } from "../../lexer";
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

/**
 * 解析本族的 op 行（`set` `define` `let` `local` `undef`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
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

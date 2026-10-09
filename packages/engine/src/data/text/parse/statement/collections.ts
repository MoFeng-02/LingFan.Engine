/** collections 族的读向解析。 */
import { parseValueLiteral, parseArrayLiteral, parseDictLiteral } from "../../literals";
import { unquote } from "../../lexer";
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

/**
 * 解析本族的 op 行（`array_push` `array_pop` `array` `dict` `dict_set` `random`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
export function parseCollectionsStatement(c: StatementContext): StoryCommand | null {
  const { op, rest, tokens, fail, quoted } = c;
  switch (op) {
    case "array_push": {
      if (tokens.length < 2) return fail("array_push 需要 key 与 value");
      return {
        op: "array_push",
        key: quoted(0),
        value: parseValueLiteral(tokens.slice(1).join(" ")),
      } as StoryCommand;
    }
    case "array_pop":
      if (tokens.length < 1) return fail("array_pop 需要 key");
      return { op: "array_pop", key: quoted(0) } as StoryCommand;
    case "array": {
      const m = /^"([^"]*)"\s+(\[.*\])(\s+once)?$/.exec(rest);
      if (m === null) return fail('array 文法：array "key" [项, …] [once]');
      const cmd: StoryCommand = {
        op: "array",
        key: unquote(`"${m[1]!}"`),
        items: parseArrayLiteral(m[2]!),
      };
      if (m[3] !== undefined) cmd.once = true;
      return cmd;
    }
    case "dict": {
      const m = /^"([^"]*)"\s+(\{.*\})(\s+once)?$/.exec(rest);
      if (m === null) return fail('dict 文法：dict "key" {…} [once]');
      const cmd: StoryCommand = {
        op: "dict",
        key: unquote(`"${m[1]!}"`),
        value: parseDictLiteral(m[2]!),
      };
      if (m[3] !== undefined) cmd.once = true;
      return cmd;
    }
    case "dict_set": {
      if (tokens.length < 3) return fail("dict_set 需要 key/field/value");
      return {
        op: "dict_set",
        key: quoted(0),
        field: quoted(1),
        value: parseValueLiteral(tokens.slice(2).join(" ")),
      } as StoryCommand;
    }
    case "random": {
      let seed: number | undefined;
      let min: number | undefined;
      let max: number | undefined;
      let key: string | undefined;
      for (const token of tokens) {
        const eq = token.indexOf("=");
        if (eq < 0) continue;
        const key2 = token.slice(0, eq);
        const value = token.slice(eq + 1);
        if (key2 === "seed") seed = Number(value);
        else if (key2 === "min") min = Number(value);
        else if (key2 === "max") max = Number(value);
        else if (key2 === "var") key = unquote(value);
      }
      if (
        seed === undefined ||
        min === undefined ||
        max === undefined ||
        key === undefined
      ) {
        return fail("random 需要 seed/min/max/var");
      }
      return {
        op: "random",
        seed,
        range: [min, max],
        var: key,
      } as StoryCommand;
    }
  }
  return null;
}

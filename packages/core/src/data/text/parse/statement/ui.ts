/** ui 族的读向解析。 */
import { parseDictLiteral, extractKeyedDictLiteral } from "../../literals.ts";
import { splitTokens } from "../../lexer.ts";
import type { StoryCommand } from "../../../../contracts/index.ts";
import type { StatementContext } from "../state.ts";

/**
 * 解析本族的 op 行（`mount`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。
 *
 * 形态：`mount <UI 名> <true|false> [props={…}]`。UI 名不带引号（短标识，与 `id=`/`name=`
 * 等位置参同形）；显隐只认字面 `true` / `false`——没有「切换」写法，避免文本形态与状态语义
 * 各说一套。
 */
export function parseUiStatement(c: StatementContext): StoryCommand | null {
  const { op, rest, tokens, fail } = c;
  switch (op) {
    case "mount": {
      const name = tokens[0];
      if (name === undefined) return fail("mount 需要 UI 名");
      const visible = tokens[1];
      if (visible !== "true" && visible !== "false")
        return fail("mount 需要 true|false（显隐必填，没有切换写法）");
      const cmd: StoryCommand = {
        op: "mount",
        name,
        visible: visible === "true",
      };
      const dict = extractKeyedDictLiteral(rest, "props");
      if (dict !== null) {
        const extra = splitTokens(dict.remainder).filter(
          (t) => t !== name && t !== visible,
        );
        if (extra.length > 0) return fail(`mount 未知参数：${extra[0]}`);
        cmd.props = parseDictLiteral(dict.literal);
        return cmd;
      }
      if (tokens.length > 2) return fail(`mount 未知参数：${tokens[2]}`);
      return cmd;
    }
  }
  return null;
}

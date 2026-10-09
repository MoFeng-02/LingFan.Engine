/** save 族的读向解析。 */
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

/**
 * 解析本族的 op 行（`save` `load` `auto_save` `save_delete`）。
 *
 * 入参是分发骨架建好的 `StatementContext`（已切好的词表、定位前缀、issue 出口与警告通道）。
 * 只处理本族的 op，不匹配时落到末尾 `return null`，由骨架决定后续。
 * 失败表现：不抛异常；语法或参数不符时用 `c.fail` 记一条带定位的 issue 并返回 `null`，
 * 由调用方按 issues 非空整次拒绝。语义暂未生效的情况记到警告通道，不阻塞解析。
 */
export function parseSaveStatement(c: StatementContext): StoryCommand | null {
  const { op, tokens, fail, quoted } = c;
  switch (op) {
    case "save": {
      // `save "s" [title "t"]`（screenshot 延后）
      if (tokens.length < 1) return fail("save 需要 slot");
      const cmd: StoryCommand = { op: "save", slot: quoted(0) };
      if (tokens[1] === "title") {
        const title = quoted(2);
        if (title === "") return fail("save title 需要标题文本");
        cmd.title = title;
      }
      return cmd;
    }
    case "load":
      if (tokens.length < 1) return fail("load 需要 slot");
      return { op: "load", slot: quoted(0) } as StoryCommand;
    case "auto_save":
      if (tokens.length < 1)
        return fail("auto_save 需要 enabled（true/false）");
      if (tokens[0] !== "true" && tokens[0] !== "false") {
        return fail("auto_save 需要 enabled（true/false）");
      }
      return { op: "auto_save", enabled: tokens[0] === "true" } as StoryCommand;
    case "save_delete":
      if (tokens.length < 1) return fail("save_delete 需要 slot");
      return { op: "save_delete", slot: quoted(0) } as StoryCommand;
  }
  return null;
}

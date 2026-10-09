/** save 族的读向解析。 */
import { StoryCommand } from "../../../../contracts";
import { StatementContext } from "../state";

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

/** dialog 族的文本投影。 */
import { quoteForText, instanceZText } from "../../literals";
import { StoryCommand } from "../../../../contracts";
import { GenerateContext } from "../context";

/**
 * 投影本族的 op 行（`say` `notify` `wait` `pause` `input` `nvl` `assert` `guard`）。
 *
 * 入参是分发骨架建好的 `GenerateContext`：`pad` 是本行缩进前缀（块体逐层加深），
 * `out` 是输出缓冲，投影出的行直接推入，不留空行。
 * 无返回值，结果通过 `out` 交付。
 * 失败表现：字段无法投影（缺字符串、字典字段缺失等）时抛 `TextFormatError`，不是静默跳过——
 * 由上层按命令粒度捕获后降级为 issue，使整棵树的其余部分照常输出。
 */
export function generateDialogCommand(cmd: StoryCommand, c: GenerateContext): void {
  const { pad, out } = c;
  switch (cmd.op) {
    case "say": {
      let line = `${pad}say ${quoteForText(cmd.text as string)}`;
      if (cmd.speaker !== undefined && cmd.speaker !== "")
        line += ` speaker=${quoteForText(cmd.speaker as string)}`;
      if (cmd.clickable === true) line += " clickable";
      if (cmd.noskip === true) line += " noskip";
      if (cmd.instant === true) line += " instant";
      if (cmd.typewriter !== undefined) line += ` typewriter=${cmd.typewriter}`;
      if (cmd.template !== undefined)
        line += ` template=${quoteForText(cmd.template as string)}`;
      if (cmd.voice !== undefined)
        line += ` voice=${quoteForText(cmd.voice as string)}`;
      line += instanceZText(cmd);
      out.push(line);
      return;
    }
    case "notify": {
      let line = `${pad}notify ${quoteForText(cmd.text as string)}`;
      if (cmd.type !== undefined)
        line += ` type=${quoteForText(cmd.type as string)}`;
      if (cmd.duration !== undefined) line += ` duration=${cmd.duration}`;
      line += instanceZText(cmd);
      out.push(line);
      return;
    }
    case "wait":
      out.push(
        `${pad}wait ${cmd.seconds}${cmd.skipable === true ? " skipable" : ""}`,
      );
      return;
    case "pause":
      out.push(`${pad}pause ${cmd.seconds}`);
      return;
    case "input":
      out.push(
        `${pad}input ${quoteForText(cmd.prompt as string)} store=${quoteForText(cmd.store as string)}${instanceZText(cmd)}`,
      );
      return;
    case "nvl": {
      const mode = (cmd.mode as string | undefined) ?? "enter";
      out.push(
        mode === "enter" || mode === "auto"
          ? `${pad}nvl${mode === "auto" ? " auto" : ""}`
          : `${pad}nvl ${mode}`,
      );
      return;
    }
    case "assert": {
      const message = cmd.message as string | undefined;
      out.push(
        `${pad}assert ${cmd.cond}${message !== undefined ? ` ${quoteForText(message)}` : ""}`,
      );
      return;
    }
    case "guard": {
      // args = 裸 JSON 字面量（`for "v" in {expr}` 同族的裸花括号口径）：
      // quoteForText 会转义内层引号 ⇒ 解析正则吃不下。JSON.stringify 确定性（插入序）。
      const args = cmd.args as Record<string, unknown> | undefined;
      out.push(
        `${pad}guard ${quoteForText(cmd.fn as string)}${args !== undefined ? ` ${JSON.stringify(args)}` : ""}`,
      );
      return;
    }
  }
}

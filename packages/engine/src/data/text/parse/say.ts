/** `say` 行的读向解析：位置参数取文本，其余按 key=value 收敛到命令字段。 */
import { unquote } from "../lexer";
import type { StoryCommand } from "../../../contracts";

export const SAY_FLAGS = new Set(["clickable", "okey", "noskip", "instant"]);

export function parseSay(
  tokens: string[],
  at: string,
  issues: string[],
): StoryCommand {
  const cmd: StoryCommand = { op: "say", text: "" };
  let sawText = false;
  for (const token of tokens) {
    const eq = token.indexOf("=");
    const isFlag = SAY_FLAGS.has(token);
    if (!sawText && token.startsWith('"')) {
      cmd.text = unquote(token);
      sawText = true;
      continue;
    }
    if (eq > 0) {
      const key = token.slice(0, eq);
      const value = token.slice(eq + 1);
      switch (key) {
        case "speaker":
        case "by":
          cmd.speaker = unquote(value);
          continue;
        case "typewriter":
          cmd.typewriter = Number(value);
          continue;
        case "template":
          cmd.template = unquote(value);
          continue;
        case "color":
          // 说话人颜色覆盖（写入 `SYS.currentDialogColor`）。
          // 与**行内标记** `{color=…}`（写在文本内部、标记某段文字）是两件事。
          // 格式校验在运行期（`isValidSayColor`）与编辑器 schema（同一判据）——投影层只搬运。
          cmd.color = unquote(value);
          continue;
        case "voice":
          cmd.voice = unquote(value);
          continue;
        case "z":
        case "z-index": // 实例级 z（别名：统一收敛为 `z`）
          cmd.z = Number(value);
          continue;
        case "clickable":
        case "noskip":
        case "instant":
        case "okey":
          cmd[key === "okey" ? "clickable" : key] = value === "true";
          continue;
        default:
          issues.push(`${at}: say 未知参数：${key}`);
          continue;
      }
    }
    if (isFlag) {
      cmd[token === "okey" ? "clickable" : token] = true;
      continue;
    }
    issues.push(`${at}: say 无法识别的参数：${token}`);
  }
  if (!sawText) issues.push(`${at}: say 缺少 text 字符串`);
  return cmd;
}

/** 块体命令的缩进体投影，以及自定义 op 行投影的兜底调用。 */
import { generateCommand } from "./command";
import type { CustomOpProjections, StoryCommand } from "../../../contracts";

/** 自定义 op 行投影兜底（不抛约束的引擎半边）：抛出/空行 = null → 上层整次拒绝 */
export function tryProjectToText(
  toText: (cmd: Readonly<StoryCommand>) => string | null,
  cmd: StoryCommand,
): string | null {
  try {
    const line = toText(cmd);
    return typeof line === "string" && line.trim() !== "" ? line : null;
  } catch {
    return null;
  }
}

export function generateBody(
  commands: StoryCommand[],
  indent: string,
  out: string[],
  projections?: CustomOpProjections,
): void {
  const inner = `${indent}  `;
  for (const cmd of commands) generateCommand(cmd, inner, out, projections);
}

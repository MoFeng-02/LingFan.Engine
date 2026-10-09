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

/**
 * 把一个命令数组投影成缩进块：每条命令在 `indent` 基础上再加两空格后交给 `generateCommand`。
 *
 * 输入：`commands` 命令列表、`indent` 本块所属的缩进前缀、`out` 输出缓冲、
 * 可选 `projections` 自定义 op 的文本投影表。
 * 产出：无返回值，行按原顺序推入 `out`。
 * 失败表现：不吞异常——单条命令的不可投影照原样抛出，由调用方按命令粒度捕获降级。
 */
export function generateBody(
  commands: StoryCommand[],
  indent: string,
  out: string[],
  projections?: CustomOpProjections,
): void {
  const inner = `${indent}  `;
  for (const cmd of commands) generateCommand(cmd, inner, out, projections);
}

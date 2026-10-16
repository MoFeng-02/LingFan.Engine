/**
 * 块体命令的缩进体投影：逐条命令交给调用方注入的投影器。
 */

import type {
  CustomOpProjections,
  StoryCommand,
} from "../../../contracts/index.ts";

/** 单条命令的文本投影器（分发骨架注入，见 `command.ts`）。 */
export type CommandProjector = (
  cmd: StoryCommand,
  pad: string,
  out: string[],
  projections?: CustomOpProjections,
) => void;

/**
 * 把一个命令数组投影成缩进块：每条命令在 `indent` 基础上再加两空格后交给 `project`。
 *
 * 输入：`commands` 命令列表、`indent` 本块所属的缩进前缀、`out` 输出缓冲、
 * `project` 单条命令的投影器、可选 `projections` 自定义 op 的文本投影表。
 * 产出：无返回值，行按原顺序推入 `out`。
 * 失败表现：不吞异常——单条命令的不可投影照原样抛出，由调用方按命令粒度捕获降级。
 */
export function generateBody(
  commands: StoryCommand[],
  indent: string,
  out: string[],
  project: CommandProjector,
  projections?: CustomOpProjections,
): void {
  const inner = `${indent}  `;
  for (const cmd of commands) project(cmd, inner, out, projections);
}

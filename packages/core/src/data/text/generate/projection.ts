/**
 * 自定义 op 行投影的兜底调用（不抛约束的引擎半边）：抛出或空行都算「投影不出」。
 */

import type { StoryCommand } from "../../../contracts/index.ts";

/**
 * 调用一条自定义 op 的文本投影，把结果收成「有行 / 无线」两态。
 *
 * 输入：`toText` 扩展提供的投影函数、`cmd` 待投影的命令。
 * 产出：投影出的非空行；投影函数抛异常或返回空白串时返回 `null`（上层据此整次拒绝）。
 */
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

/**
 * 等待声明表：**哪些 op 建立等待点**（= 检查点边界）的单一事实源。
 *
 * 为什么需要这张表：运行时的等待态由 `engine.ts` 各 `execXxx` 方法就地设置，静态消费者
 * （编辑器视图 / 步数统计 / 未来的章节切分）无从得知「哪些命令会停下来等玩家」。
 * 把这条事实声明化后，静态侧只消费本表，**不在外部另立一套判定**。
 *
 * 语义边界（务必与运行时一致，由 `tests/engine/runtime/waiting-ops.test.ts` 行为互锁）：
 * - **建立等待** = 命令执行后故事停在该处等玩家/定时器/外部信号，并在该处提交检查点。
 * - **不建立等待**（并入其后最近的等待点、或作流程转移）：`video` 系列（非阻塞播放，故事继续）、
 *   `jump` / `navigate` / `load`（控制转移，检查点由落点自身建立）、以及全部状态与表现类命令。
 * - `cutscene` 是**阻塞过场**（等待态 `video`），与 `video` 的非阻塞播放不同。
 *
 * 块体（if/while/switch/func 体）内的等待点：其检查点坐标按 `checkpointCoord` 的块帧回退语义
 * 落在**块进入命令**上——故静态切分时「块体内含等待 ⇒ 该块命令本身即边界」，无需逐 op 特判。
 */
import type { WaitingState } from "../contracts";

/** 单个 op 的等待规格：等待态 + 是否硬等待（`pause` = 不可跳过） */
export interface WaitSpec {
  state: WaitingState;
  /** 硬等待（不随时间/点击推进，只能由外部解除）——目前仅 `pause` */
  hard?: true;
}

/** op → 等待规格（内建等待 op 全集；扩展 op 不产生等待态，见 `waitingStateOfOp`） */
export const WAITING_OPS: ReadonlyMap<string, WaitSpec> = new Map<
  string,
  WaitSpec
>([
  ["say", { state: "dialog" }],
  ["menu", { state: "menu" }],
  ["wait", { state: "wait" }],
  ["pause", { state: "wait", hard: true }],
  ["input", { state: "input" }],
  ["cutscene", { state: "video" }],
  ["minigame", { state: "minigame" }],
  ["interaction", { state: "interaction" }],
]);

/**
 * 命令的等待态：表中 op 返回其等待态；其余（含未知 op 与扩展 op）返回 `"none"`。
 * 扩展 op 的执行语义是「执行成功即步进」，不建立等待态。
 */
export function waitingStateOfOp(op: unknown): WaitingState | "none" {
  if (typeof op !== "string") return "none";
  return WAITING_OPS.get(op)?.state ?? "none";
}

/** 该命令是否建立等待（切分「步骤」的边界判据） */
export function waitSpecOfOp(op: unknown): WaitSpec | undefined {
  if (typeof op !== "string") return undefined;
  return WAITING_OPS.get(op);
}
/**
 * 等待声明表：**哪些 op 建立等待点**（= 检查点边界）的单一事实源。
 *
 * 为什么需要这张表：运行时的等待态由 `runtime/ops/` 各 `execXxx` 处理器就地设置，静态消费者
 * （编辑器视图 / 步数统计 / 未来的章节切分）无从得知「哪些命令会停下来等玩家」。
 * 把这条事实声明化后，静态侧只消费本表，**不在外部另立一套判定**。
 *
 * 语义边界（务必与运行时一致，由 `tests/engine/runtime/waiting-ops.test.ts` 行为互锁）：
 * - **建立等待** = 命令执行后故事停在该处等玩家/定时器/外部信号，并在该处提交检查点。
 * - **不建立等待**（并入其后最近的等待点、或作流程转移）：`video` 系列（非阻塞播放，故事继续）、
 *   `jump` / `navigate` / `load`（控制转移，检查点由落点自身建立）、以及全部状态与表现类命令。
 * - `cutscene` 是**阻塞过场**（等待态 `video`），与 `video` 的非阻塞播放不同。
 * - 扩展 op：内建表不解释——声明 `wait: true` 的扩展 op 经 `collectWaitSpecs` 并入同一
 *   合并面（等待态恒 `"extension"`），未声明者不产生等待规格。
 *
 * 块体（if/while/switch/func 体）内的等待点：其检查点坐标按 `checkpointCoord` 的块帧回退语义
 * 落在**块进入命令**上——故静态切分时「块体内含等待 ⇒ 该块命令本身即边界」，无需逐 op 特判。
 */
import type { OpExtension, WaitingState } from "../contracts";

/** 单个 op 的等待规格：等待态 + 是否硬等待（`pause` = 不可跳过） */
export interface WaitSpec {
  state: WaitingState;
  /** 硬等待（不随时间/点击推进，只能由外部解除）——目前仅 `pause` */
  hard?: true;
}

/** op → 等待规格（内建等待 op 全集，一行不动；扩展 op 的等待声明走 `collectWaitSpecs` 合并面） */
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
 * 命令的等待态：内建表查取，表外（未知 op 与扩展 op）返回 `"none"`。
 * 内建表不解释扩展 op——声明 `wait: true` 的扩展 op 的等待态只存在于
 * `collectWaitSpecs` 合并面，本函数对扩展 op 恒返回 `"none"`（静态取值不合并扩展声明）。
 */
export function waitingStateOfOp(op: unknown): WaitingState | "none" {
  if (typeof op !== "string") return "none";
  return WAITING_OPS.get(op)?.state ?? "none";
}

/** 该命令是否建立等待（切分「步骤」的边界判据；只看内建表，扩展面见 `collectWaitSpecs`） */
export function waitSpecOfOp(op: unknown): WaitSpec | undefined {
  if (typeof op !== "string") return undefined;
  return WAITING_OPS.get(op);
}

/**
 * 合并等待规格表：内建表 + 扩展 op 的等待声明。
 *
 * 扩展 op 在 `OpDefinition` 声明 `wait: true` 即进入本合并面（等待态恒 `"extension"`）；
 * 未声明的扩展 op 不产生等待规格。**内建表 `WAITING_OPS` 一行不动**——本函数是
 * 唯一的扩展合并面，静态消费者（编辑器等待提示/步数统计）应消费它而非自行扫扩展；
 * 扩展 op 名与内建/跨扩展重名在注册期已被查重拒绝，合并无覆盖冲突。
 * `base` 供合并面透传（编辑器 `OpSurface.waiting` 以既有合并面打底再并入，裁定⑦）；
 * 缺省 = 内建表。
 */
export function collectWaitSpecs(
  extensions: readonly OpExtension[],
  base: ReadonlyMap<string, WaitSpec> = WAITING_OPS,
): ReadonlyMap<string, WaitSpec> {
  const merged = new Map<string, WaitSpec>(base);
  for (const extension of extensions) {
    for (const op of extension.ops ?? []) {
      if (op.wait === true) merged.set(op.op, { state: "extension" });
    }
  }
  return merged;
}

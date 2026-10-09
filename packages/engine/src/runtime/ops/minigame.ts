/**
 * minigame op 的执行与解除：建立小游戏等待、回填结果、中断接管。
 *
 * 引擎只负责校验负载、写下等待态与实例 z、提交检查点、发挂载事件（携 AbortSignal）；
 * 结果由宿主经命令面回填，奖励在命令执行期求值以保证重放确定性。
 */
import {
  SYS,
  type MinigameResult,
  type OutboundEvent,
  type OutboundPayload,
  type StoryCommand,
} from "../../contracts";
import { ExpressionError } from "../expr";
import type { Frame, OpContext } from "../internal";

/** minigame 已知负载字段（未知字段 fail-closed） */
const MINIGAME_FIELDS = new Set([
  "op",
  "game",
  "config",
  "on_success",
  "on_fail",
  "reward",
  "z", // 实例级 z（minigame 层）
]);

/**
 * minigame op：建立小游戏等待（同 menu/wait/input 建立检查点），
 * 发布挂载事件（signal 供回溯/中断卸载）。语义：reward.value 执行期求值
 * （支持 {expr}，重放经 rngState 恢复保持确定性）；on_success/on_fail 缺省 = 原列继续。
 */
export function execMinigame(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  const unknownFields = Object.keys(cmd).filter((k) => !MINIGAME_FIELDS.has(k));
  if (unknownFields.length > 0) {
    ctx.fail(
      "minigame-unknown-field",
      `minigame 未知负载字段：${unknownFields.join(", ")}`,
    );
    return;
  }
  if (typeof cmd.game !== "string" || cmd.game === "") {
    ctx.fail(
      "minigame-invalid",
      "minigame 需要非空 game 字符串（注册 gameId）",
    );
    return;
  }
  if (
    cmd.config !== undefined &&
    (typeof cmd.config !== "object" ||
      cmd.config === null ||
      Array.isArray(cmd.config))
  ) {
    ctx.fail("minigame-invalid", "minigame.config 必须为对象");
    return;
  }
  for (const field of ["on_success", "on_fail"] as const) {
    const target = cmd[field];
    if (
      target !== undefined &&
      (typeof target !== "string" || target === "")
    ) {
      ctx.fail(
        "minigame-invalid",
        `minigame.${field} 必须为非空字符串（目标列）`,
      );
      return;
    }
  }
  const reward: { key: string; value: unknown }[] = [];
  if (cmd.reward !== undefined) {
    if (!Array.isArray(cmd.reward)) {
      ctx.fail("minigame-invalid", "minigame.reward 必须为键值数组");
      return;
    }
    for (const [i, entry] of cmd.reward.entries()) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        Array.isArray(entry) ||
        typeof (entry as { key?: unknown }).key !== "string" ||
        (entry as { key: string }).key === "" ||
        !("value" in entry)
      ) {
        ctx.fail(
          "minigame-invalid",
          `minigame.reward[${i}] 必须为 { key, value }（key 非空字符串，value 必填）`,
        );
        return;
      }
      try {
        reward.push({
          key: (entry as { key: string }).key,
          value: ctx.evalValue((entry as { value: unknown }).value),
        });
      } catch (e) {
        if (e instanceof ExpressionError) {
          ctx.fail(e.code, e.message);
          return;
        }
        throw e;
      }
    }
  }
  ctx.minigameSeq += 1;
  const seq = ctx.minigameSeq;
  const controller = new AbortController();
  ctx.minigameController = controller;
  ctx.pendingMinigame = {
    onSuccess: typeof cmd.on_success === "string" ? cmd.on_success : undefined,
    onFail: typeof cmd.on_fail === "string" ? cmd.on_fail : undefined,
    reward,
  };
  ctx.setInstanceZ(SYS.minigameZ, cmd.z); // 本次挂载的实例 z（minigame 层）
  ctx.setSystem(SYS.minigame, {
    game: cmd.game,
    config: (cmd.config ?? {}) as Record<string, unknown>,
    seq,
  });
  ctx.setSystem(SYS.waiting, "minigame");
  // 等待建立时提交检查点；重放期同坐标原位替换（重放重新挂载 = 新 seq 新 signal）
  ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
  ctx.liveCheckpointed = true;
  ctx.autoSaveAtCheckpoint(); // 小游戏等待画面建立 = auto_save 消费点
  frame.index += 1;
  const payload: OutboundPayload = {
    kind: "minigame.mount",
    game: cmd.game,
    config: (cmd.config ?? {}) as Record<string, unknown>,
    signal: controller.signal,
    seq,
  };
  const event: OutboundEvent = { v: 1, kind: "event", payload };
  for (const listener of ctx.eventListeners) listener(event);
}

/**
 * 会话命令 `resolveMinigame`：UI 小游戏完成后回填结果（命令面）。
 *
 * success → 奖励写状态（走 ValueChanged 事件流，历史可溯）→ on_success 分流；
 * fail → on_fail 分流；目标缺省 = 原列继续。非等待期 / 畸形结果 fail-closed。
 */
export function resolveMinigame(
  ctx: OpContext,
  result: MinigameResult,
): boolean {
  if (ctx.get(SYS.waiting) !== "minigame") {
    ctx.fail(
      "minigame-resolve-invalid",
      `resolveMinigame 仅在小游戏等待中有效（当前 __waiting=${String(ctx.get(SYS.waiting))}）`,
    );
    return false;
  }
  if (
    typeof result !== "object" ||
    result === null ||
    (result.outcome !== "success" && result.outcome !== "fail")
  ) {
    ctx.fail(
      "minigame-result-invalid",
      "resolveMinigame 需要 outcome = success | fail",
    );
    return false;
  }
  if (
    result.score !== undefined &&
    (typeof result.score !== "number" || !Number.isFinite(result.score))
  ) {
    ctx.fail(
      "minigame-result-invalid",
      "resolveMinigame.score 必须为有限数字",
    );
    return false;
  }
  const pending = ctx.pendingMinigame;
  if (pending === null) {
    ctx.fail("minigame-state-corrupt", "__waiting=minigame 但挂起状态缺失");
    return false;
  }
  ctx.pendingMinigame = null;
  ctx.minigameController = null; // 正常完成：不 abort（UI 已自行收尾）
  ctx.setSystem(SYS.waiting, "none");
  ctx.liveCheckpointed = false; // live 已越过该检查点（对齐 wait 完成语义）
  if (result.outcome === "success") {
    for (const entry of pending.reward) {
      ctx.setGlobal(entry.key, entry.value); // 奖励即状态变更（历史可溯）
    }
  }
  const target =
    result.outcome === "success" ? pending.onSuccess : pending.onFail;
  if (target !== undefined && !ctx.enterColumn(target)) return false;
  ctx.run();
  return true;
}

/** 回溯联动：中断小游戏等待 = abort 挂载信号（UI 卸载），重放到该坐标重新挂载 */
export function abortMinigame(ctx: OpContext): void {
  if (ctx.minigameController !== null) {
    ctx.minigameController.abort();
    ctx.minigameController = null;
  }
  ctx.pendingMinigame = null;
}

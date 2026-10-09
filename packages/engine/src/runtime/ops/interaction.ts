/**
 * 等待型外部输入的执行：input（文本输入）、interaction（玩法系统整屏接管）。
 *
 * 两者都建立玩家可见的等待画面并交出控制权：引擎写好等待态与实例 z、提交检查点、
 * 发挂载事件（interaction 如此；input 由命令面回填），解除权在各命令面入口。
 */
import {
  GAME_SYSTEM_ID_PATTERN,
  SYS,
  gameScopedKey,
  type InteractionResult,
  type OutboundEvent,
  type OutboundPayload,
  type StoryCommand,
} from "../../contracts";
import type { Frame, OpContext } from "../internal";
import { writeExternal } from "../state";

/** interaction 已知负载字段（未知字段 fail-closed） */
const INTERACTION_FIELDS = new Set([
  "op",
  "system",
  "config",
  "on_success",
  "on_fail",
  "z", // 实例级 z（与 minigame 同层：外部系统整屏接管）
]);

/** input（prompt + store）→ 进入 input 等待；options 选项式输入延后（解析层拒绝） */
export function execInput(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  // 输入态清对话残留（与 menu 同语义）
  ctx.setSystem(SYS.currentDialogText, "");
  ctx.setSystem(SYS.currentDialogSpeaker, "");
  ctx.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
  ctx.setSystem(
    SYS.inputPrompt,
    typeof cmd.prompt === "string" ? ctx.translate(cmd.prompt) : "",
  );
  ctx.inputStore = cmd.store as string;
  ctx.setInstanceZ(SYS.choicesZ, cmd.z); // 输入形态的实例 z（choices 层）
  ctx.setSystem(SYS.waiting, "input");
  // input 检查点在等待建立时；重放期同坐标原位替换
  ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
  ctx.liveCheckpointed = true;
  ctx.autoSaveAtCheckpoint(); // input 等待画面建立 = auto_save 消费点
  frame.index += 1;
}

/**
 * interaction op：把控制权交给外部玩法系统（行走 / 战斗 / QTE…），引擎等待其回填。
 *
 * 语义与 minigame op 逐条对齐（不新造等待语义）：建立等待 → 提交检查点 →
 * auto_save 消费点 → 出站挂载事件（携 AbortSignal）→ 外部 `resolveInteraction` 解除。
 * 重放（回溯/读档）同坐标原位重新挂载 = 新 seq 新 signal。
 */
export function execInteraction(
  ctx: OpContext,
  frame: Frame,
  cmd: StoryCommand,
): void {
  if (ctx.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
  const unknownFields = Object.keys(cmd).filter(
    (k) => !INTERACTION_FIELDS.has(k),
  );
  if (unknownFields.length > 0) {
    ctx.fail(
      "interaction-unknown-field",
      `interaction 未知负载字段：${unknownFields.join(", ")}`,
    );
    return;
  }
  const system = cmd.system;
  if (typeof system !== "string" || !GAME_SYSTEM_ID_PATTERN.test(system)) {
    ctx.fail(
      "interaction-invalid",
      `interaction.system 必填且为合法系统标识（匹配 ${String(GAME_SYSTEM_ID_PATTERN)}）`,
    );
    return;
  }
  if (cmd.on_success !== undefined && typeof cmd.on_success !== "string") {
    ctx.fail(
      "interaction-invalid",
      "interaction.on_success 必须为字符串（目标列 id）",
    );
    return;
  }
  if (cmd.on_fail !== undefined && typeof cmd.on_fail !== "string") {
    ctx.fail(
      "interaction-invalid",
      "interaction.on_fail 必须为字符串（目标列 id）",
    );
    return;
  }
  if (
    cmd.config !== undefined &&
    (typeof cmd.config !== "object" ||
      cmd.config === null ||
      Array.isArray(cmd.config))
  ) {
    ctx.fail("interaction-invalid", "interaction.config 必须为对象（原样透传宿主）");
    return;
  }
  ctx.interactionSeq += 1;
  const seq = ctx.interactionSeq;
  const controller = new AbortController();
  ctx.interactionController = controller;
  ctx.pendingInteraction = {
    system,
    onSuccess: typeof cmd.on_success === "string" ? cmd.on_success : undefined,
    onFail: typeof cmd.on_fail === "string" ? cmd.on_fail : undefined,
  };
  ctx.setInstanceZ(SYS.interactionZ, cmd.z); // 本次挂载的实例 z
  ctx.setSystem(SYS.interaction, {
    system,
    config: (cmd.config ?? {}) as Record<string, unknown>,
    seq,
  });
  ctx.setSystem(SYS.waiting, "interaction");
  // 等待建立时提交检查点；重放期同坐标原位替换（重放重新挂载 = 新 seq 新 signal）
  ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
  ctx.liveCheckpointed = true;
  ctx.autoSaveAtCheckpoint(); // 玩法系统接管画面建立 = auto_save 消费点
  frame.index += 1;
  const payload: OutboundPayload = {
    kind: "interaction.mount",
    system,
    config: (cmd.config ?? {}) as Record<string, unknown>,
    signal: controller.signal,
    seq,
  };
  const event: OutboundEvent = { v: 1, kind: "event", payload };
  for (const listener of ctx.eventListeners) listener(event);
}

/**
 * 会话命令 `resolveInteraction`：宿主经注册表跑完外部玩法系统后回填结果。
 *
 * 与 `resolveMinigame` 同构（等待态守卫 / 结果校验 / 分流 / 继续执行），
 * 差别：无 reward（那是小游戏专属语义），改以 `result.state` 落本系统命名空间状态。
 */
export function resolveInteraction(
  ctx: OpContext,
  system: string,
  result: InteractionResult,
): boolean {
  if (ctx.get(SYS.waiting) !== "interaction") {
    ctx.fail(
      "interaction-resolve-invalid",
      `resolveInteraction 仅在玩法系统等待中有效（当前 __waiting=${String(ctx.get(SYS.waiting))}）`,
    );
    return false;
  }
  const pending = ctx.pendingInteraction;
  if (pending === null) {
    ctx.fail("interaction-state-corrupt", "__waiting=interaction 但挂起状态缺失");
    return false;
  }
  if (typeof system !== "string" || system !== pending.system) {
    ctx.fail(
      "interaction-system-mismatch",
      `resolveInteraction 的系统标识不符：期望 ${pending.system}，收到 ${String(system)}`,
    );
    return false;
  }
  if (
    typeof result !== "object" ||
    result === null ||
    (result.outcome !== "success" && result.outcome !== "fail")
  ) {
    ctx.fail(
      "interaction-result-invalid",
      "resolveInteraction 需要 outcome = success | fail",
    );
    return false;
  }
  if (
    result.score !== undefined &&
    (typeof result.score !== "number" || !Number.isFinite(result.score))
  ) {
    ctx.fail(
      "interaction-result-invalid",
      "resolveInteraction.score 必须为有限数字",
    );
    return false;
  }
  // 结果附带的状态：落本系统命名空间（外部系统不必自己拼前缀，也不该裸写全局）
  if (result.state !== undefined) {
    if (
      typeof result.state !== "object" ||
      result.state === null ||
      Array.isArray(result.state)
    ) {
      ctx.fail("interaction-result-invalid", "resolveInteraction.state 必须是对象");
      return false;
    }
    for (const [key, value] of Object.entries(result.state)) {
      if (
        !writeExternal(ctx, gameScopedKey(pending.system, key), value, true, pending.system)
      ) {
        return false;
      }
    }
  }
  ctx.pendingInteraction = null;
  ctx.interactionController = null; // 正常完成：不 abort（宿主已自行收尾）
  ctx.setSystem(SYS.waiting, "none");
  ctx.liveCheckpointed = false; // live 已越过该检查点（对齐 wait 完成语义）
  const target =
    result.outcome === "success" ? pending.onSuccess : pending.onFail;
  if (target !== undefined && !ctx.enterColumn(target)) return false;
  ctx.run();
  return true;
}

/** 回溯联动：中断玩法系统接管 = abort 挂载信号（宿主卸载），重放到该坐标重新挂载 */
export function abortInteraction(ctx: OpContext): void {
  if (ctx.interactionController !== null) {
    ctx.interactionController.abort();
    ctx.interactionController = null;
  }
  ctx.pendingInteraction = null;
}

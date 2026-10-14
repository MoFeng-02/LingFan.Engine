/**
 * 扩展 op 的执行：故事里出现的自定义命令交给注册表里对应的扩展函数。
 *
 * 失败即停机：扩展函数返回非成功结果、或直接抛异常（由 `runRegisteredOp`
 * 兜底转成错误码），都经 `fail` 出站 `engine.error` 并停在当前命令，
 * 不做「跳过继续」——故事作者写错扩展名或扩展违约时，静默跳过比报错更难查。
 *
 * 副作用只允许经扩展上下文写状态（键名被物理强制加 `ext.<id>.` 前缀），
 * 所以扩展之间不会互相覆盖状态。
 *
 * 等待（扩展 op 的第三种落点）：声明 `wait: true` 的 op 返回 `{ok:"wait"}` 即请求挂起。
 * 建立等待全部由引擎做（exec 保持同步、不发请求）：记挂起记录 → 推进序号 →
 * 建中止句柄 → 写等待态 → 同坐标原位提交检查点 → auto_save 消费点 → 帧前进 →
 * 出站 `extension.mount`；解除走 `resolveExtensionOp`（四道守卫 fail-closed），
 * 中断走 `abortExtensionOp`（汇入 `abortExternalTakeovers` 的五处中断点）。
 */
import {
  SYS,
  gameScopedKey,
  type ExtensionOpResult,
  type OutboundEvent,
  type OutboundPayload,
  type StoryCommand,
} from "../../contracts/index.ts";
import type { Frame, OpContext } from "../internal/index.ts";
import { writeExternal } from "../state/index.ts";
import { runRegisteredOp, type RegisteredOp } from "../opRegistry.ts";

/**
 * 执行一条扩展 op。
 *
 * 返回 `"advanced"` = 执行成功，分发器步进到下一条命令；
 * 返回 `"wait"` = op 已建立等待并自帧前进，分发器停在该处等解除；
 * 返回 `"fail"` = 已 `fail`，停机。
 *
 * 一旦真正执行过，就把扩展 id 记进依赖集合——存档据此声明「这份存档依赖哪些扩展」，
 * 读档时缺了对应扩展会被拒绝，而不是带着错误状态继续跑。
 */
export function execExtensionOp(
  ctx: OpContext,
  frame: Frame,
  entry: RegisteredOp,
  cmd: StoryCommand,
): "advanced" | "wait" | "fail" {
  ctx.usedExtensions.add(entry.extensionId);
  const outcome = runRegisteredOp(entry, cmd, ctx.story, {
    get: (key) => ctx.get(key),
    setGlobal: (key, value) => ctx.setGlobal(key, value),
  });
  if (outcome.ok === true) return "advanced";
  if (outcome.ok === false) {
    ctx.fail(outcome.code, outcome.message);
    return "fail";
  }
  // 第三态（ok = "wait"）：请求挂起。fail-closed——未声明 `wait: true` 的 op 没有等待权，
  // 状态原样停机（该判据只能运行期给：声明位是静态假边界，声明了不等待 = 合法）。
  if (entry.definition.wait !== true) {
    ctx.fail(
      "custom-op-wait-undeclared",
      `扩展 op ${entry.definition.op} 未声明 wait: true，不能返回等待结果`,
    );
    return "fail";
  }
  ctx.extensionWaitSeq += 1;
  const seq = ctx.extensionWaitSeq;
  const controller = new AbortController();
  ctx.extensionController = controller;
  ctx.pendingExtensionOp = {
    op: entry.definition.op,
    extensionId: entry.extensionId,
    onSuccess:
      typeof outcome.on_success === "string" ? outcome.on_success : undefined,
    onFail: typeof outcome.on_fail === "string" ? outcome.on_fail : undefined,
  };
  ctx.setSystem(SYS.waiting, "extension");
  // 等待建立时提交检查点；重放期同坐标原位替换（重放重新挂载 = 新 seq 新 signal）
  ctx.commitCheckpoint(ctx.takeSnapshot(ctx.checkpointCoord(frame)));
  ctx.liveCheckpointed = true;
  ctx.autoSaveAtCheckpoint(); // 扩展等待画面建立 = auto_save 消费点
  frame.index += 1;
  const payload: OutboundPayload = {
    kind: "extension.mount",
    op: entry.definition.op,
    extensionId: entry.extensionId,
    config: (outcome.config ?? {}) as Record<string, unknown>,
    signal: controller.signal,
    seq,
  };
  const event: OutboundEvent = { v: 1, kind: "event", payload };
  for (const listener of ctx.eventListeners) listener(event);
  return "wait";
}

/**
 * 会话命令 `resolveExtensionOp`：宿主跑完扩展 op 的等待流程后回填结果。
 *
 * 与 `resolveInteraction` 同构（等待态守卫 / 挂起记录守卫 / 身份守卫 / 结果校验 /
 * 回填 / 分流 / 继续执行），差别：身份键是 op（引擎注册表键；interaction 用宿主
 * 注册表的 system），状态落 `game.<extensionId>.<key>` 命名空间（extensionId 取自挂起记录）。
 */
export function resolveExtensionOp(
  ctx: OpContext,
  op: string,
  result: ExtensionOpResult,
): boolean {
  if (ctx.get(SYS.waiting) !== "extension") {
    ctx.fail(
      "extension-resolve-invalid",
      `resolveExtensionOp 仅在扩展 op 等待中有效（当前 __waiting=${String(ctx.get(SYS.waiting))}）`,
    );
    return false;
  }
  const pending = ctx.pendingExtensionOp;
  if (pending === null) {
    ctx.fail("extension-state-corrupt", "__waiting=extension 但挂起记录缺失");
    return false;
  }
  if (typeof op !== "string" || op !== pending.op) {
    ctx.fail(
      "extension-op-mismatch",
      `resolveExtensionOp 的 op 不符：期望 ${pending.op}，收到 ${String(op)}`,
    );
    return false;
  }
  if (
    typeof result !== "object" ||
    result === null ||
    (result.outcome !== "success" && result.outcome !== "fail")
  ) {
    ctx.fail(
      "extension-result-invalid",
      "resolveExtensionOp 需要 outcome = success | fail",
    );
    return false;
  }
  // 结果附带的状态：落本扩展命名空间（外部不必自己拼前缀，也不该裸写全局）
  if (result.state !== undefined) {
    if (
      typeof result.state !== "object" ||
      result.state === null ||
      Array.isArray(result.state)
    ) {
      ctx.fail(
        "extension-result-invalid",
        "resolveExtensionOp.state 必须是对象",
      );
      return false;
    }
    for (const [key, value] of Object.entries(result.state)) {
      if (
        !writeExternal(
          ctx,
          gameScopedKey(pending.extensionId, key),
          value,
          true,
          pending.extensionId,
        )
      ) {
        return false;
      }
    }
  }
  ctx.pendingExtensionOp = null;
  ctx.extensionController = null; // 正常完成：不 abort（宿主已自行收尾）
  ctx.setSystem(SYS.waiting, "none");
  ctx.liveCheckpointed = false; // live 已越过该检查点（对齐 interaction 完成语义）
  const target =
    result.outcome === "success" ? pending.onSuccess : pending.onFail;
  if (target !== undefined && !ctx.enterColumn(target)) return false;
  ctx.run();
  return true;
}

/** 回溯联动：中断扩展 op 等待 = abort 挂载信号（宿主卸载），重放到该坐标重新挂载 */
export function abortExtensionOp(ctx: OpContext): void {
  if (ctx.extensionController !== null) {
    ctx.extensionController.abort();
    ctx.extensionController = null;
  }
  ctx.pendingExtensionOp = null;
}

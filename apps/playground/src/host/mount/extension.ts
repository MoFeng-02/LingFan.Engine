/**
 * 扩展 op 等待接管：`extension.mount` 事件的宿主处理（覆盖层展示态的编排）。
 *
 * 覆盖层是「确认即解除」的挂起画面：中断（回溯/导航/读档/热重载/销毁）以 abort
 * 收尾——订阅先行，重放的新挂载顶掉旧订阅。解除动作与覆盖层标记归
 * `App/ExtensionOverlayCard.vue` 的消费方（App.vue），本文件只维护展示态与订阅。
 */

import type { AbortHandle, ExtensionMountPayload } from "@lingfan/engine";
import { abortSignalOf } from "../engine/abort-signal";

/** 当前扩展等待的展示态（null = 无扩展等待）；解除权在宿主——覆盖层「确认」触发 resolve */
export interface ExtensionOverlay {
  op: string;
  extensionId: string;
  title: string;
  detail: string;
  signal: AbortHandle;
}

/** 扩展挂载分支所需的宿主侧依赖 */
export interface ExtensionMountDeps {
  /** 覆盖层展示态（挂载置值、abort 清空） */
  overlay: { value: ExtensionOverlay | null };
}

/** 扩展挂载分支：处理挂载 + 暴露订阅解除（宿主确认解除时成对撤销订阅） */
export interface ExtensionMountHandler {
  /** 处理一条 `extension.mount`：置展示态并订阅中止 */
  (payload: ExtensionMountPayload): void;
  /** 解除当前 abort 订阅（展示态清空由调用方负责；无订阅时为空操作） */
  abort(): void;
}

/**
 * 造扩展挂载分支处理器：闭包持有 abort 订阅解除（重放的新挂载顶掉旧订阅；
 * 非响应式，仅组件内流转）。
 */
export function createExtensionMountHandler(
  deps: ExtensionMountDeps,
): ExtensionMountHandler {
  let extensionAbort: (() => void) | null = null;
  const handler = (payload: ExtensionMountPayload): void => {
    // 中断（回溯/导航/读档/热重载/销毁）以 abort 收尾——订阅先行，重放的新挂载顶掉旧订阅。
    extensionAbort?.();
    const abortSignal = abortSignalOf(payload.signal);
    const onAbort = (): void => {
      abortSignal.removeEventListener("abort", onAbort);
      extensionAbort = null;
      deps.overlay.value = null;
    };
    abortSignal.addEventListener("abort", onAbort, { once: true });
    extensionAbort = () => abortSignal.removeEventListener("abort", onAbort);
    deps.overlay.value = {
      op: payload.op,
      extensionId: payload.extensionId,
      title: `扩展等待 · ${payload.extensionId}.${payload.op}`,
      // 详情优先取扩展算好的 state 读数（config.detail），回退 title 字段（都缺省则不渲染详情行）
      detail:
        typeof payload.config.detail === "string"
          ? payload.config.detail
          : typeof payload.config.title === "string"
            ? payload.config.title
            : "",
      signal: payload.signal,
    };
  };
  handler.abort = (): void => {
    extensionAbort?.();
    extensionAbort = null;
  };
  return handler;
}

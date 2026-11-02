/**
 * 出站事件的分流落点：引擎发来的 `event` 按种类分到提示条、小游戏接管、扩展覆盖层、
 * 存档完成与错误横幅。
 *
 * 分流顺序是接线契约的一部分——分支的先后决定同一次出站被谁消费（例如写档成功只报
 * 提示条、不落错误横幅），所以整张分派表集中在这一处，装配层只把它接到引擎订阅上。
 * 例外是外部玩法系统接管（`interaction.mount`）：那一支要用装配层闭包里的挂载点与
 * 输入域，留在组件里前置处理，其余种类一律转到这里。
 *
 * 写档成功要刷新「继续」槽位摘要，而会话装配晚于本装配：刷新动作经注入的回调取用，
 * 在分支被触发时才求值（与装配先后无关）。
 */

import type { Ref } from "vue";
import type { OutboundPayload, StoryEngine } from "@lingfan-engine/core";
import type { NarrativeEvents } from "@lingfan-engine/shell";
import { handleMinigameMount, type ExtensionMountHandler } from "../../mount";
import type { VueNarrativeState } from "../../narrative/runtime/narrative-state";

/** 装配入参：事件落点、挂载接管面、引擎句柄与两个读数取用 */
export interface AppEventRouterOptions {
  /** 叙事视图状态（小游戏接管态从它读） */
  narrative: VueNarrativeState;
  /** 小游戏注册表与扩展覆盖层处理器 */
  mounts: {
    minigames: Parameters<typeof handleMinigameMount>[1]["minigames"];
    handleExtensionMount: ExtensionMountHandler;
  };
  /** 叙事事件落点（各分支经它生效） */
  narrativeEvents: NarrativeEvents;
  /** 引擎句柄取用（挂载解析与失败上报） */
  getEngine: () => StoryEngine;
  /** 错误横幅内容（挂载分支的 fail-closed 上报） */
  error: Ref<string>;
  /** 小游戏系统的挂载点取用（DemoHost 暴露的容器） */
  readMinigameHost: () => HTMLElement | null;
  /** 写档成功后的槽位摘要刷新（会话装配晚于本装配，故按需取用） */
  refreshResumeSlot: () => void;
}

/** 事件分流能力：把一条出站事件分到对应落点 */
export interface AppEventRouter {
  /** 引擎 `event` 订阅回调 */
  route: (event: { payload: OutboundPayload }) => void;
}

/**
 * 造事件分流器：提示条、读档诊断、小游戏接管与错误横幅的落点在这里固定。
 * 每条分支做什么归 `@lingfan-engine/shell` 的事件域与 `host/mount/` 挂载分支。
 */
export function createAppEventRouter(
  options: AppEventRouterOptions,
): AppEventRouter {
  const { narrative, mounts, narrativeEvents, getEngine, error } = options;
  const { inMinigame } = narrative;
  function route({ payload }: { payload: OutboundPayload }): void {
    if (payload.kind === "notify") {
      narrativeEvents.notify(
        payload.text,
        payload.notifyType,
        payload.duration,
      );
    } else if (payload.kind === "minigame.mount") {
      // 宿主经注册表解析工厂挂载；未注册 fail-closed（不伪造完成，等待保持）
      handleMinigameMount(payload, {
        minigames: mounts.minigames,
        readHost: options.readMinigameHost,
        inMinigame,
        error,
        resolveMinigame: (result) => getEngine().resolveMinigame(result),
        writer: getEngine().gameState,
      });
    } else if (payload.kind === "extension.mount") {
      // 扩展 op 等待接管：宿主展示关闭式覆盖层（本组件唯一的扩展演示接缝）
      mounts.handleExtensionMount(payload);
    } else if (payload.kind === "save.done") {
      // 写档成功（失败走 engine.error 分支，不提示成功）；槽位变多，「继续」要能点到新的档
      narrativeEvents.saved(payload.slot);
      options.refreshResumeSlot();
    } else if (payload.kind === "load.done") {
      // 读档完成（引擎已重放到存档坐标）——清错误、同步渲染与媒体
      narrativeEvents.loaded(payload.slot);
    } else if (payload.kind === "rollback.done") {
      narrativeEvents.rollbackDone(); // 回放完成解除输入锁并同步渲染
    } else if (payload.kind === "load.notice") {
      // 读档诊断（非致命，宿主应知情）：演示宿主以通知条展示
      narrativeEvents.loadNotice(payload.text);
    } else if (payload.kind === "character.missing") {
      // 注销知情（非致命）：演示宿主以通知条提示，故事继续推进
      narrativeEvents.notify(
        `角色 ${payload.key} 未注册，跳过注销`,
        "warning",
        undefined,
      );
    } else if (payload.kind === "engine.error") {
      // 兜底只剩引擎错误：其余种类都在上面认领，外部玩法接管不进这张表
      narrativeEvents.failed(payload.code, payload.message);
    }
  }
  return { route };
}

/**
 * 玩法系统挂载分支：`interaction.mount` 事件的宿主处理。
 *
 * 与小游戏分支同构（解析 → 订阅中止 → 挂载 → 回填），叠加输入域交接：
 * 接管期间切 `world` 让位推进/回溯键，收尾交还 `dialogue`。
 * 分流顺序（哪个分支在前）是 App.vue 的接线契约，本文件只提供这条分支做什么。
 */

import type {
  GameStateWriter,
  InteractionMountPayload,
  InteractionResult,
} from "@lingfan/engine";
import { abortSignalOf } from "../engine/abort-signal";
import type { WalkFactory } from "../demos/interaction-walk";

/** 玩法系统挂载分支所需的宿主侧依赖 */
export interface InteractionMountDeps {
  /** 玩法系统注册表（system 名 → 工厂） */
  interactions: Map<string, WalkFactory>;
  /** 共享挂载点元素（DemoHost 暴露；不在场 = 无处挂载，静默返回） */
  readHost(): HTMLElement | null;
  /** 玩法挂载层可见性（挂载置位、收尾复位） */
  inInteraction: { value: boolean };
  /** 输入域（接管切 world、收尾交还 dialogue） */
  inputScope: { set(scope: "world" | "dialogue"): void };
  /** fail-closed 与异常上报（错误横幅） */
  error: { value: string };
  /** 结果回填（按 system 名回引擎） */
  resolveInteraction(system: string, result: InteractionResult): void;
  /** 外部系统写引擎状态的唯一面（状态即接口） */
  writer: GameStateWriter;
}

/** 处理一条 `interaction.mount`：解析工厂 → 交接输入域 → 订阅中止 → 挂载 → 回填结果 */
export function handleInteractionMount(
  payload: InteractionMountPayload,
  deps: InteractionMountDeps,
): void {
  const factory = deps.interactions.get(payload.system);
  if (factory === undefined) {
    deps.error.value = `玩法系统未注册：${payload.system}（fail-closed，可回溯/导航离开）`;
    return;
  }
  const host = deps.readHost();
  if (host === null) return;
  deps.inInteraction.value = true;
  // 接管期间切「玩法域」：推进/回溯键整体让位（不必逐事件 preventDefault）。
  // 域归宿主状态——输入路由是展示层职责，引擎只暴露等待态。
  deps.inputScope.set("world");
  // 中止事件订阅需要具体的中止类型：契约层只承诺 `aborted`，这里收窄回本宿主的实现
  const abortSignal = abortSignalOf(payload.signal);
  const onAbort = (): void => {
    abortSignal.removeEventListener("abort", onAbort);
    host.innerHTML = "";
    deps.inInteraction.value = false;
    // 工厂在共享宿主上加的演示类必须随收尾移除。本处是**两条结束路径的唯一汇合点**
    // （回填成功与中断都经此），故只写一次——分两处写必然漏一条，
    // 症状是残留类让「已结束的接管」在下次仍被算作进行中。
    host.classList.remove("walk-demo");
    // 外部接管结束：域交还叙事
    deps.inputScope.set("dialogue");
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });
  void factory(host, {
    config: payload.config,
    signal: payload.signal,
    seq: payload.seq,
    writer: deps.writer, // 外部系统写引擎状态的唯一面（状态即接口）
  })
    .then((result) => {
      if (payload.signal.aborted) return; // 中断竞态：以 abort 收尾为准
      onAbort();
      deps.resolveInteraction(payload.system, result);
    })
    .catch((e: unknown) => {
      deps.error.value = `玩法系统异常：${String(e)}`;
      onAbort();
    });
}

/**
 * 玩法系统挂载分支：`interaction.mount` 事件的宿主处理（模板形态）。
 *
 * 与小游戏分支同构（解析 → 订阅中止 → 挂载 → 回填），叠加输入域交接：
 * 接管期间切 `world` 让位推进/回溯键，收尾交还 `dialogue`。
 * 依赖都是窄接口：可见性/错误用 `{ value }` 值格，容器读法与结果回填由宿主注入。
 */
import type {
  GameStateWriter,
  InteractionMountPayload,
  InteractionResult,
} from "@lingfan-engine/core";
import { abortSignalOf, type InputScopeState } from "@lingfan-engine/ui";
import type { InteractionRegistry } from "./interaction-demo";

/** 玩法系统挂载分支所需的宿主侧依赖 */
export interface InteractionMountDeps {
  /** 玩法系统注册表（system 名 → 工厂） */
  interactions: InteractionRegistry;
  /** 共享挂载点（与小游戏同点；不在场 = 无处挂载，fail-closed 上报） */
  readHost(): HTMLElement | null;
  /** 玩法挂载层可见性（挂载置位、收尾复位） */
  inInteraction: { value: boolean };
  /** 输入域（接管切 world、收尾交还 dialogue）；缺省不做域交接 */
  inputScope?: InputScopeState;
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
  if (host === null) {
    deps.error.value = `玩法系统 ${payload.system} 无处挂载：页面没有 #minigame 槽位（等待保持，可回溯/导航离开）`;
    return;
  }
  deps.inInteraction.value = true;
  // 接管期间切「玩法域」：推进/回溯键整体让位。域归宿主状态——输入路由是展示层职责
  deps.inputScope?.set("world");
  // 中止事件订阅需要具体的中止类型：契约层只承诺 `aborted`，这里收窄回本宿主的实现
  const abortSignal = abortSignalOf(payload.signal);
  const onAbort = (): void => {
    abortSignal.removeEventListener("abort", onAbort);
    host.innerHTML = "";
    deps.inInteraction.value = false;
    // 外部接管结束：域交还叙事。本处是两条结束路径的唯一汇合点（回填与中断都经此）
    deps.inputScope?.set("dialogue");
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

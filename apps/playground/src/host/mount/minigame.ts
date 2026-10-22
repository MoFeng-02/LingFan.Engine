/**
 * 小游戏挂载分支：`minigame.mount` 事件的宿主处理。
 *
 * 职责三段——经注册表解析工厂（未注册 fail-closed 上报，不伪造完成）、
 * 订阅中止（两条结束路径的唯一汇合点，演示类随收尾移除）、回填结果。
 * 分流顺序（哪个分支在前）是 App.vue 的接线契约，本文件只提供这条分支做什么。
 */

import type {
  GameStateWriter,
  MinigameMountPayload,
  MinigameResult,
} from "@lingfan-engine/core";
import type { MinigameRegistry } from "@lingfan-engine/ui";
import { abortSignalOf } from "../engine/abort-signal";

/** 小游戏挂载分支所需的宿主侧依赖 */
export interface MinigameMountDeps {
  /** 小游戏注册表（解析工厂） */
  minigames: MinigameRegistry;
  /** 共享挂载点元素（DemoHost 暴露；不在场 = 无处挂载，静默返回） */
  readHost(): HTMLElement | null;
  /** 玩法挂载层可见性（收尾复位） */
  inMinigame: { value: boolean };
  /** fail-closed 与异常上报（错误横幅） */
  error: { value: string };
  /** 结果回填（引擎继续） */
  resolveMinigame(result: MinigameResult): void;
  /** 外部系统写引擎状态的唯一面（状态即接口） */
  writer: GameStateWriter;
}

/** 处理一条 `minigame.mount`：解析工厂 → 订阅中止 → 挂载 → 回填结果 */
export function handleMinigameMount(
  payload: MinigameMountPayload,
  deps: MinigameMountDeps,
): void {
  const factory = deps.minigames.get(payload.game);
  if (factory === undefined) {
    deps.error.value = `小游戏未注册：${payload.game}（fail-closed，可回溯/导航离开）`;
    return;
  }
  const host = deps.readHost();
  if (host === null) return;
  // 中止事件订阅需要具体的中止类型：契约层只承诺 `aborted`，这里收窄回本宿主的实现
  const abortSignal = abortSignalOf(payload.signal);
  const onAbort = (): void => {
    abortSignal.removeEventListener("abort", onAbort);
    host.innerHTML = "";
    // 工厂在共享宿主上加的演示类必须随收尾移除（本处是两条结束路径的唯一汇合点，
    // 故只写一次；写在工厂内会漏掉「正常完成」那条路）
    host.classList.remove("minigame-demo");
    deps.inMinigame.value = false;
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });
  // 先收进变量再传参：注册表工厂只声明 MinigameContext（不认得 writer），
  // 新鲜字面量会被多余属性检查拒绝，变量形态交由结构化可赋值放行。
  const ctx = {
    config: payload.config,
    signal: payload.signal,
    seq: payload.seq,
    writer: deps.writer,
  };
  void factory(host, ctx)
    .then((result: MinigameResult) => {
      if (payload.signal.aborted) return; // 中断竞态：以 abort 收尾为准
      onAbort();
      deps.resolveMinigame(result);
    })
    .catch((e: unknown) => {
      deps.error.value = `小游戏异常：${String(e)}`;
      onAbort();
    });
}

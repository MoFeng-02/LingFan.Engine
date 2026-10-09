/**
 * 小游戏注册表（UI 层职责）：minigame 命令只声明 gameId，
 * 宿主经注册表解析工厂后挂载。与对话框模板注册表的关键差异：**未知 gameId 无默认回退**
 * ——get 返回 undefined = fail-closed（宿主必须显式上报，不得伪造完成）。
 */

import type { MinigameFactory } from "@lingfan/engine";

/**
 * 小游戏 id → 工厂的查表。`get` 未命中即 `undefined`，调用方必须显式上报
 * ——玩法系统没注册时不能假装玩完了，否则叙事会带着假的完成结果往下走。
 */
export interface MinigameRegistry {
  /** 注册/覆盖更新（同 gameId 再注册 = 替换，开发热替换语义） */
  register(gameId: string, factory: MinigameFactory): void;
  /** 解析工厂；未注册 = undefined（fail-closed：不伪造默认实现） */
  get(gameId: string): MinigameFactory | undefined;
  has(gameId: string): boolean;
}

/** 造一张空的小游戏表；玩法系统由宿主在装配期逐个注册 */
export function createMinigameRegistry(): MinigameRegistry {
  const factories = new Map<string, MinigameFactory>();
  return {
    register(gameId: string, factory: MinigameFactory): void {
      factories.set(gameId, factory);
    },
    get(gameId: string): MinigameFactory | undefined {
      return factories.get(gameId);
    },
    has(gameId: string): boolean {
      return factories.has(gameId);
    },
  };
}

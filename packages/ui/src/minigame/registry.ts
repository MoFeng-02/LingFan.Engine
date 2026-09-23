/**
 * 06 §二/D5 小游戏注册表（UI 层职责）：minigame 命令只声明 gameId，
 * 宿主经注册表解析工厂后挂载。与对话框模板注册表的关键差异：**未知 gameId 无默认回退**
 * ——get 返回 undefined = fail-closed（宿主必须显式上报，不得伪造完成）。
 * 锚点: minigame-fail-closed-and-abortable
 */

import type { MinigameFactory } from "@lingfan/engine";

export interface MinigameRegistry {
  /** 注册/覆盖更新（同 gameId 再注册 = 替换，开发热替换语义） */
  register(gameId: string, factory: MinigameFactory): void;
  /** 解析工厂；未注册 = undefined（fail-closed，D5：不伪造默认实现） */
  get(gameId: string): MinigameFactory | undefined;
  has(gameId: string): boolean;
}

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

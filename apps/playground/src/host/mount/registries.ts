/**
 * 挂载注册表装配：小游戏与玩法系统的「game/system 名 → 工厂」查表，加输入域。
 *
 * 两个注册表同口径：**未注册 = fail-closed**（不伪造完成、等待保持）。
 * 演示工厂在此就地注册——挂载点上的演示类字面串留在装配处，样式表与
 * 源级互锁都按这里的写法读；真实玩法系统由产品自行实现并注册。
 */

import {
  createInputScopeState,
  createMinigameRegistry,
  type InputScopeState,
  type MinigameRegistry,
} from "@lingfan/ui";
import { createClick3Demo } from "../demos/minigame-demo";
import {
  createInteractionWalk,
  type WalkFactory,
} from "../demos/interaction-walk";

/** 挂载注册表与输入域（挂载解析与键位路由共用） */
export interface MountRegistries {
  /** 小游戏注册表：game 名 → 工厂 */
  minigames: MinigameRegistry;
  /** 玩法系统注册表：system 名 → 工厂 */
  interactions: Map<string, WalkFactory>;
  /**
   * 输入域（宿主状态）：叙事层消费推进/回溯键的前提。
   * `dialogue` = 叙事激活（默认）；玩法系统接管时切 `world` 整体让位。
   * 与 `data-ui-zone`（控件消费优先）正交——前者管「模式」，后者管「事件目标」。
   */
  inputScope: InputScopeState;
}

/** 造挂载注册表与输入域；演示工厂就地注册（见头注释） */
export function createMountRegistries(): MountRegistries {
  const minigames = createMinigameRegistry();
  // 演示小游戏「点够次数」：config.target 次点击后成功（signal abort = 立即收尾不回填）。
  // DOM 构建在 `../minigame-demo.ts`；装配只提供宿主侧事实（容器类标记的写法）。
  minigames.register(
    "click3",
    createClick3Demo({
      markHost: (host) => {
        host.classList.add("minigame-demo");
      },
    }),
  );
  const interactions = new Map<string, WalkFactory>();
  // 演示玩法系统：DOM 与按键循环在 `../interaction-walk.ts`；
  // 装配只提供宿主侧事实（容器类标记的写法）与可调参数（默认值即演示值）。
  interactions.set(
    "walk",
    createInteractionWalk({
      markHost: (host) => {
        host.classList.add("walk-demo");
      },
    }),
  );
  return { minigames, interactions, inputScope: createInputScopeState() };
}

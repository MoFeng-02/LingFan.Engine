/**
 * 层级 z 控制器：持有实例级覆盖表，并负责把它写回各挂载点的 `z-index`。
 *
 * 三级链由引擎的 `resolveInstanceZ` 决定（**实例显式指定 > 工程层默认 > 内建默认**），
 * 本控制器只负责「收下覆盖值 → 重算 → 写样式」这一段接线。
 */
import { resolveInstanceZ } from "@lingfan/engine";
import type { LayerId, LayerZOverrides, LayerZTable } from "@lingfan/engine";
import type { NarrativeMounts } from "./types";

/** 层级 z 控制器（每实例一份覆盖表） */
export interface LayerZController {
  /** 实例级覆盖：只含显式指定过的层；未指定即回层默认 */
  overrides: LayerZOverrides;
  /** 把当前覆盖表应用到各层（幂等，可反复调用） */
  apply(): void;
}

/** 收藏一个实例 z 键的新值（`undefined` = 取消该层覆盖） */
export function setLayerOverride(
  controller: LayerZController,
  layer: LayerId,
  instanceZ: number | undefined,
): void {
  controller.overrides = { ...controller.overrides, [layer]: instanceZ };
}

export function createLayerZController(
  mounts: NarrativeMounts,
  layerZ: LayerZTable,
): LayerZController {
  const controller: LayerZController = {
    overrides: {},
    apply(): void {
      const z = controller.overrides;
      mounts.dialogue.style.zIndex = String(
        resolveInstanceZ("dialogue", z.dialogue, layerZ),
      );
      mounts.choices.style.zIndex = String(
        resolveInstanceZ("choices", z.choices, layerZ),
      );
      mounts.overlay.style.zIndex = String(
        resolveInstanceZ("notifications", z.notifications, layerZ),
      );
      mounts.takeover.style.zIndex = String(
        resolveInstanceZ("minigame", z.minigame, layerZ),
      );
      mounts.transition.style.zIndex = String(
        resolveInstanceZ("video", z.video, layerZ),
      );
    },
  };
  return controller;
}

/**
 * 层级 z 控制器：持有实例级覆盖表，并负责把它写回各层（经覆盖层端口下发）。
 *
 * 三级链由引擎的 `resolveInstanceZ` 决定（**实例显式指定 > 工程层默认 > 内建默认**），
 * 本控制器只负责「收下覆盖值 → 重算 → 经端口下发」这一段接线。
 *
 * 与宿主模板绑定的同名概念区分：本控制器直接把 z 下发到覆盖层端口；宿主若要拿响应式镜像
 * 给模板绑定（`:style="{ zIndex: zOf(...) }"`），那是宿主自己的控制器（如 playground 的
 * `HostLayerZController`），承载面与层表都不同。
 */
import { resolveInstanceZ } from "@lingfan/engine";
import type { LayerId, LayerZOverrides, LayerZTable } from "@lingfan/engine";
import type { OverlaySurface } from "./surface";

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

/**
 * 造一个层级控制器：覆盖表初始为空（全部层走默认），需调 `apply()` 才下发 z。
 *
 * `layerZ` 是工程级的层默认表，控制器只在其上加一层「实例显式指定」的覆盖；
 * 覆盖表逐实例持有，所以两个覆盖层不会互相改 z。下发是幂等的，重复调无副作用。
 */
export function createLayerZController(
  surface: OverlaySurface,
  layerZ: LayerZTable,
): LayerZController {
  const controller: LayerZController = {
    overrides: {},
    apply(): void {
      const z = controller.overrides;
      surface.setLayerZ(
        "dialogue",
        resolveInstanceZ("dialogue", z.dialogue, layerZ),
      );
      surface.setLayerZ(
        "choices",
        resolveInstanceZ("choices", z.choices, layerZ),
      );
      surface.setLayerZ(
        "notifications",
        resolveInstanceZ("notifications", z.notifications, layerZ),
      );
      surface.setLayerZ(
        "takeover",
        resolveInstanceZ("minigame", z.minigame, layerZ),
      );
      surface.setLayerZ(
        "transition",
        resolveInstanceZ("video", z.video, layerZ),
      );
    },
  };
  return controller;
}

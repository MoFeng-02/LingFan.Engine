/**
 * 层级 z：把「实例级 z 覆盖」这张表按层落到渲染面上。
 *
 * 一个层最终用哪个 z 由三级链决定（实例 > 工程层默认 > 内建），判定本身在引擎里
 * （`resolveInstanceZ`）；本模块只负责两件事：
 * 1. 记住某层被命令参数覆盖成了什么（`setOverride`），值不是数字时视为「回层默认」；
 * 2. 用注入的 `applyLayerZ` 把六个 DOM 层交给宿主去写。
 *
 * 视频层单独一个方法：它的 z 不在 DOM 上而在视频端口内部，且**只在视频层自己变化时**
 * 才需要下发。合并进 `apply()` 会让「改标题栏层级」也顺手写一次视频样式——多出来的
 * 那一次写没有任何语义，却足以让「谁在改 DOM」变得难查。
 */

import { resolveInstanceZ, type LayerId, type LayerZTable } from "@lingfan/engine";

/** 由 DOM 承载的层（顺序即写入顺序；视频/小游戏/历史/偏好不在此表） */
const DOM_LAYERS: readonly LayerId[] = [
  "stage",
  "dialogue",
  "choices",
  "notifications",
  "toolbar",
];

/** 层级视图的输入：工程层默认表 + 两个下发出口（视频层可省） */
export interface LayerViewOptions {
  /** 工程层默认（`project.json` 的 `shell.layers`） */
  layerZ: LayerZTable;
  /** 写某个 DOM 层的 z 序 */
  applyLayerZ(layer: LayerId, z: number): void;
  /** 视频层 z 下发（端口内部；不提供时 `applyVideo()` 为空操作） */
  onVideoZ?(z: number): void;
}

/** 层级视图句柄：实例级覆盖的收纳与下发 */
export interface LayerView {
  /** 命令参数写入的实例级覆盖：`undefined` = 回层默认 */
  setOverride(layer: string, value: number | undefined): void;
  /** 某个层的最终 z */
  zOf(layer: LayerId): number;
  /** 把所有 DOM 层的最终 z 下发一次（装配期与每次覆盖变化后调用） */
  apply(): void;
  /** 单独下发视频层 z（仅在该层变化后调用） */
  applyVideo(): void;
}

/**
 * 创建层级视图：覆盖表在闭包里，每实例一份。
 * `apply()` 只遍历由 DOM 承载的层；视频层走 `applyVideo()` 单独下发。
 */
export function createLayerView(options: LayerViewOptions): LayerView {
  const overrides: Partial<Record<string, number>> = {};

  const zOf = (layer: LayerId): number =>
    resolveInstanceZ(layer, overrides[layer], options.layerZ);

  return {
    setOverride(layer: string, value: number | undefined): void {
      if (value === undefined) delete overrides[layer];
      else overrides[layer] = value;
    },
    zOf,
    apply(): void {
      for (const layer of DOM_LAYERS) options.applyLayerZ(layer, zOf(layer));
    },
    applyVideo(): void {
      options.onVideoZ?.(zOf("video"));
    },
  };
}

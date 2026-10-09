/**
 * 层级装配：把展示层的层级视图接到本宿主的 DOM 节点与视频端口上。
 *
 * 展示层管的是「某层最终该是多少」（实例覆盖 > 工程默认 > 内建），本文件管的是
 * 「这个值写到哪个节点上」——这层映射是本宿主独有的，不放进共享面。
 *
 * 视频层的 z 不在 DOM 上而在端口内部，且只在视频层自己变化时才下发（见 `LayerView`），
 * 所以这里用 getter 取端口：装配期先落一次 DOM 层，那时端口还没建。
 */

import { createLayerView, type LayerView } from "@lingfan/ui";
import type { LayerId, LayerZTable, VideoPort } from "@lingfan/engine";
import type { StageDom } from "./stage-dom";

/**
 * 层级视图的输入：节点句柄表、工程层默认表与视频端口取值器。
 * 端口用取值器而非实例：装配期要先落一次 DOM 层，那时端口还没建好。
 */
export interface HostLayerZOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 工程层默认（`project.json` 的 `shell.layers`） */
  layerZ: LayerZTable;
  /** 取当前视频端口（尚未建好时返回 null） */
  readVideoPort(): VideoPort | null;
}

/** 某个 DOM 层落到哪个（或哪些）节点上 */
function writeLayerZ(dom: StageDom, layer: LayerId, z: number): void {
  const value = String(z);
  if (layer === "stage") dom.stage.style.zIndex = value;
  // 对话层的 z 同时管对话框与 NVL 层：两者互斥显示，但要处在同一层级上
  else if (layer === "dialogue") {
    dom.dialogue.style.zIndex = value;
    dom.nvl.style.zIndex = value;
  } else if (layer === "choices") dom.choices.style.zIndex = value;
  else if (layer === "notifications") dom.notifications.style.zIndex = value;
  else if (layer === "toolbar") dom.toolbar.style.zIndex = value;
}

/** 造本宿主的层级视图：DOM 层写节点，视频层的 z 下发到端口内部 */
export function createHostLayerZ(options: HostLayerZOptions): LayerView {
  return createLayerView({
    layerZ: options.layerZ,
    applyLayerZ: (layer, z) => writeLayerZ(options.dom, layer, z),
    onVideoZ: (z) => {
      options.readVideoPort()?.setZIndex?.(z);
    },
  });
}

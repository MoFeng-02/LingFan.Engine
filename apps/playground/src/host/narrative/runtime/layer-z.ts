/**
 * 层 z 的落地：实例级覆盖 > 工程层默认 > 内建默认（三级链）。
 *
 * 本宿主的 DOM z 走模板绑定（`:style="{ zIndex: zOf('choices') }"`），所以覆盖值需要留一份
 * **响应式镜像**——模板读镜像才能在该层 z 变化时重渲染；判定「数值是否合法、回落到哪一级」
 * 归共享的 `createLayerView`，视频层的 z 由它经 `applyVideo` 下发给端口（该层不在 DOM 上）。
 *
 * 写入只走 `set` / `restore` 两个入口，镜像与共享视图始终拿同一个值，不会各说各话。
 *
 * 与展示层覆盖层的同名概念区分：这里是**宿主 DOM 模板绑定的镜像控制器**（读 `zOf()` 落 `:style`），
 * 覆盖层内部的 `LayerZController`（`@lingfan/ui` 的 `overlay/layer-z.ts`）则直接把 z 下发到覆盖层端口。
 */
import { ref, type Ref } from "vue";
import {
  INSTANCE_Z_KEYS,
  resolveInstanceZ,
  type LayerId,
  type LayerZTable,
} from "@lingfan/engine";
import { createLayerView, type LayerView } from "@lingfan/ui";

/** 层 z 镜像控制器的输入 */
export interface HostLayerZControllerOptions {
  /** 工程层默认表（三级链的第二级） */
  layerZ: LayerZTable;
  /** 把解析后的 z 落到视频端口（端口重建后需重新下发一次） */
  applyVideoZ(z: number): void;
}

/** 宿主层 z 镜像控制器 */
export interface HostLayerZController {
  /** 实例级覆盖镜像（模板绑定读它；改动即触发重渲染） */
  readonly overrides: Ref<Partial<Record<string, number>>>;
  /** 某层当前的 z（模板绑定用） */
  zOf(layer: LayerId): number;
  /** 改一层实例级覆盖；`undefined` = 该层回工程层默认 */
  set(layer: LayerId, z: number | undefined): void;
  /** 整体回档：表里没有的层回落到工程层默认，并同步视频端口 */
  restore(z: Partial<Record<string, number>>): void;
  /** 重新下发视频层 z（视频端口重建后调用） */
  refreshVideo(): void;
}

/**
 * 创建宿主层 z 镜像控制器。
 */
export function createHostLayerZController(
  options: HostLayerZControllerOptions,
): HostLayerZController {
  const overrides = ref<Partial<Record<string, number>>>({});
  const view: LayerView = createLayerView({
    layerZ: options.layerZ,
    // DOM 层由模板绑定读镜像落值，这里不直接写样式
    applyLayerZ: () => undefined,
    onVideoZ: (z) => {
      options.applyVideoZ(z);
    },
  });

  return {
    overrides,
    zOf(layer: LayerId): number {
      return resolveInstanceZ(layer, overrides.value[layer], options.layerZ);
    },
    set(layer: LayerId, z: number | undefined): void {
      view.setOverride(layer, z);
      overrides.value = { ...overrides.value, [layer]: z };
      // 视频层的 z 不在 DOM 上而在端口内部：改完立刻下发
      if (layer === "video") view.applyVideo();
    },
    restore(z: Partial<Record<string, number>>): void {
      // 逐层写一遍：表里没有的层必须显式清掉覆盖，否则会留着上一次的实例 z
      for (const layer of Object.keys(INSTANCE_Z_KEYS)) {
        view.setOverride(layer, z[layer]);
      }
      overrides.value = z;
      view.applyVideo();
    },
    refreshVideo(): void {
      view.applyVideo();
    },
  };
}

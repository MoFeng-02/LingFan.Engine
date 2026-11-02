/**
 * 挂载接管的宿主侧总装：小游戏/玩法系统的注册表、输入域，与扩展 op 等待覆盖层的编排。
 *
 * 三者同属「引擎报出一个挂载意图，宿主把它变成屏幕上的东西」这一条线：注册表负责
 * 解析工厂（未注册 = fail-closed），输入域负责让位（玩法接管时叙事键不消费），覆盖层
 * 负责扩展等待的确认闭环。解除动作（`resolveExtension`）由覆盖层消费者触发。
 */

import { ref, type Ref } from "vue";
import type { StoryEngine } from "@lingfan-engine/core";
import {
  createExtensionMountHandler,
  createMountRegistries,
  type ExtensionMountHandler,
  type ExtensionOverlay,
  type MountRegistries,
} from "../../mount";

/** 装配入参：引擎句柄取用（扩展解除要回填引擎） */
export interface AppMountsOptions {
  /** 引擎句柄取用（解除扩展 op 时回填成功结果；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
}

/** 挂载接管能力：注册表与输入域、扩展等待展示态、解除动作 */
export interface AppMounts extends MountRegistries {
  /** 当前扩展等待的展示态（null = 无扩展等待）；解除权在宿主 */
  extensionOverlay: Ref<ExtensionOverlay | null>;
  /** 扩展挂载分支处理器：闭包持 abort 订阅解除（重放的新挂载顶掉旧订阅） */
  handleExtensionMount: ExtensionMountHandler;
  /** 扩展等待解除：清覆盖层与订阅后回填成功结果（信号已中止则以 abort 收尾为准） */
  resolveExtension: () => void;
}

/** 装配挂载接管：注册表 + 输入域 + 扩展覆盖层编排 */
export function createAppMounts(options: AppMountsOptions): AppMounts {
  const { getEngine } = options;
  /** 当前扩展等待的展示态（null = 无扩展等待） */
  const extensionOverlay = ref<ExtensionOverlay | null>(null);
  const { minigames, interactions, inputScope } = createMountRegistries();
  const handleExtensionMount = createExtensionMountHandler({
    overlay: extensionOverlay,
  });
  /** 扩展等待解除：清覆盖层与订阅后回填成功结果（信号已中止则以 abort 收尾为准，不回填） */
  function resolveExtension(): void {
    const overlay = extensionOverlay.value;
    if (overlay === null) return;
    handleExtensionMount.abort();
    extensionOverlay.value = null;
    if (overlay.signal.aborted) return; // 中断竞态：以 abort 收尾为准
    getEngine().resolveExtensionOp(overlay.op, { outcome: "success" });
  }
  return {
    minigames,
    interactions,
    inputScope,
    extensionOverlay,
    handleExtensionMount,
    resolveExtension,
  };
}

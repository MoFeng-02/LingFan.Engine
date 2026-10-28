/**
 * 舞台元素层的宿主侧装配：核心层只写 `__elements`，这里经注册表把元素表渲染到
 * 舞台元素层容器。渲染、禁用态求值与动作分流都在宿主层叶子（`elements.ts`），
 * 本装配只把引擎命令面、资源解析与容器接进去。
 *
 * 容器是模板 ref（首帧可能尚未挂载）：元素表变化后经 `nextTick` 延后渲染。
 */

import { nextTick, watch, type Ref } from "vue";
import {
  type PlayerPreferences,
  type ResourcePort,
  type StoryEngine,
} from "@lingfan-engine/core";
import { createCommandRegistry } from "@lingfan-engine/ui";
import { createElementLayer } from "./elements";
import type { VueNarrativeState } from "../../narrative/runtime/narrative-state";

/** 装配入参：叙事状态、元素层容器、资源与引擎命令面 */
export interface AppElementLayerOptions {
  /** 叙事视图状态（元素表响应式来源） */
  narrative: VueNarrativeState;
  /** 舞台元素层容器（模板 ref；声明式空间层的挂载点） */
  elementLayerEl: Ref<HTMLElement | null>;
  /** 组合根注入的宿主属性（只读消费 `resourcePort` / `preferences`） */
  props: {
    resourcePort: ResourcePort;
    preferences: PlayerPreferences;
  };
  /** 元素 `cmd` 业务命令注册表（未注册 fail-closed，不静默丢弃） */
  commands: ReturnType<typeof createCommandRegistry>;
  /** 错误横幅内容（元素装配失败的 fail-closed 上报都落这里） */
  error: Ref<string>;
  /** 引擎句柄取用（元素动作的导航/命令面；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
}

/** 装配元素层渲染：元素表变化后经 nextTick 渲到容器（首帧容器可能尚未挂载） */
export function createAppElementLayer(options: AppElementLayerOptions): void {
  const { narrative, elementLayerEl, props, commands, error, getEngine } =
    options;
  const { elements } = narrative;
  const elementLayer = createElementLayer({
    readContainer: () => elementLayerEl.value,
    resolveResource: (path) => props.resourcePort.resolve(path),
    readElements: () => elements.value,
    engine: {
      navigate: (target) => {
        getEngine().navigate(target);
      },
      runElementOps: (ops) => getEngine().runElementOps(ops),
      interpolate: (source) => getEngine().interpolate(source),
    },
    commands,
    /**
     * 回写落点：音量走偏好（`setVolume` 内部 clamp01 并触发音频重规划），
     * 玩法状态走 `game.<系统>.<键>`（保留键与 JSON 安全由引擎写入契约把关）。
     * 两件都是既有闸门——本层不新开写入面。
     */
    writeback: {
      setVolume: (channel, value) => {
        props.preferences.setVolume(channel, value);
      },
      setScoped: (systemId, key, value) => {
        const writer = getEngine().gameState;
        return writer.setScoped(systemId, key, value);
      },
      reportError: (message) => {
        error.value = message;
      },
    },
    reportError: (message) => {
      error.value = message;
    },
  });

  watch(elements, () => {
    void nextTick(() => {
      elementLayer.render(); // 容器挂载后再渲染（首帧容器可能尚未就绪）
    });
  });
}

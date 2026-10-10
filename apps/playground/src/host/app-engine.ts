/**
 * 引擎生命周期的宿主侧装配：构造、订阅接线（state/event 出站到视图与命令面）、
 * 整体重建（restart）与订阅解除（unbind）。
 *
 * 引擎实例本身由装配层持有（`let engine`）：所有消费方经注入的取用句柄拿到当前
 * 实例——重启重建后自动指向新引擎，旧引用不残留。守卫实现来自 stories:build 的
 * cell 生成物（源 = Stories.src/story.ts 的 cell 槽位）——组合根零手写注册；名字
 * 闭合由构建期闸门执法（故事引用 ⊆ 生成注册表）。
 */

import { watch, type Ref } from "vue";
import {
  StoryEngine,
  type AudioPort,
  type I18nPort,
  type LayerId,
  type OpExtension,
  type OutboundPayload,
  type SavePort,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import { guards as engineGuards } from "../stories";
import type { AppMedia } from "./app-media";
import type { NarrativeState } from "./narrative-state";
import type { TypewriterHandle } from "./app-narrative";

/** 装配入参：宿主属性、装配层句柄与重启时需复位的各单元格 */
export interface AppEngineLifeOptions {
  /** 组合根注入的宿主属性（引擎构造与端口重建消费） */
  props: {
    story: Ref<Story>;
    i18nPort?: I18nPort;
    savePort: SavePort;
    extensions: OpExtension[];
    createAudioPort: (onError: (message: string) => void) => AudioPort;
    createVideoPort: (onError: (message: string) => void) => VideoPort;
  };
  /** 引擎实例取用（装配层持有 `let engine`，重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 引擎实例整体替换（构造与重启时由装配层调用） */
  setEngine: (engine: StoryEngine) => void;
  /** 媒体单元格（渲染器构造与重启重建） */
  media: AppMedia;
  /** 叙事视图状态（重启时逐字段复位） */
  narrative: NarrativeState;
  /** 当前显示语言（重启回默认：引擎状态重建，显示态与运行态一致） */
  currentLang: Ref<string>;
  /** 错误横幅内容（重启清空） */
  error: Ref<string>;
  /** 小游戏挂载点取用（重启时清空工厂遗留 DOM） */
  readMinigameHost: () => HTMLElement | null;
  /** 舞台元素层容器（重启时清空元素层渲染物） */
  elementLayerEl: Ref<HTMLElement | null>;
  /** 打字机共享句柄（重启置空，等新句重建） */
  typewriter: TypewriterHandle;
  /** 层最终 z（重建视频端口后补上当前实例 z） */
  zOf: (layer: LayerId) => number;
  /** 引擎状态订阅回调（state → 叙事视图状态） */
  handleState: (event: { key: string; value: unknown }) => void;
  /** 引擎事件订阅回调（event → 提示条/挂载/诊断分流） */
  handleEvent: (event: { payload: OutboundPayload }) => void;
}

/** 引擎生命周期能力：初始化接线、fail-closed 后整体重建、订阅解除 */
export interface AppEngineLife {
  /** 组合根初始化：构造引擎、接上订阅与媒体渲染器、启动；热重载随 story 注入重入 */
  initEngine: () => void;
  /** fail-closed 停机（引擎报错后拒绝继续）的恢复入口：整体重建引擎 */
  restart: () => void;
  /** 订阅解除（重启与卸载共用；与 bindEngine 成对） */
  unbind: () => void;
}

/** 装配引擎生命周期：构造引擎接线订阅，重启整体重建并复位各单元格 */
export function createAppEngineLife(options: AppEngineLifeOptions): AppEngineLife {
  const {
    props,
    getEngine,
    setEngine,
    media,
    narrative,
    currentLang,
    error,
    readMinigameHost,
    elementLayerEl,
    typewriter,
    zOf,
    handleState,
    handleEvent,
  } = options;
  const {
    speaker, text, shownText, canAdvance, inMenu, inWait, inInput, inVideo,
    inMinigame, menuPrompt, inputPrompt, inputValue, rawTexts, rawTargets,
    dialogTemplateName, nvlMode, nvlBuffer, elements,
  } = narrative;
  let offState: (() => void) | undefined;
  let offEvent: (() => void) | undefined;
  function bindEngine(e: StoryEngine): void {
    offState = e.onStateChanged(handleState);
    offEvent = e.onEvent(handleEvent);
  }
  /** 订阅解除（重启与卸载共用；与 bindEngine 成对） */
  function unbind(): void {
    offState?.();
    offEvent?.();
  }
  function initEngine(): void {
    // SavePort 注入引擎——存档编排（槽位校验/坐标/写读/错误出站）归核心层命令面，
    // UI 只发 save/load 命令并反应完成信号（save.done / load.done）
    setEngine(
      new StoryEngine(props.story.value, {
        i18nPort: props.i18nPort,
        savePort: props.savePort,
        guards: engineGuards,
        extensions: props.extensions,
      }),
    );
    bindEngine(getEngine());
    media.audioRenderer = media.createRenderer();
    media.videoRenderer = media.createVideo();
    getEngine().start();
    // 热重载：组合根重新组装后注入新 story → 保运行态（变量/历史）重入当前列
    // 监听 ref 本身（value 变化才触发；() => props.story 监听恒定 Ref 引用 = 永不触发）
    watch(props.story, (fresh) => getEngine().reloadStory(fresh));
  }
  /**
   * fail-closed 停机（引擎报错后拒绝继续）的恢复入口：整体重建引擎。
   * 正式形态由命令面承担（读档/回标题，03/05）；演示层先给最简重开。
   */
  function restart(): void {
    unbind();
    // 停播并释放播放器，再释放已解析 URL（顺序：先停播后回收，Blob 场景才安全）
    media.audioPort.dispose();
    media.audioRenderer?.dispose();
    media.audioPort = props.createAudioPort(media.reportAudioError);
    media.videoPort.dispose();
    media.videoRenderer?.dispose();
    media.videoPort = props.createVideoPort(media.reportAudioError);
    media.videoPort.setZIndex?.(zOf("video")); // 重建端口后补上当前实例 z
    getEngine().dispose();
    setEngine(
      new StoryEngine(props.story.value, {
        i18nPort: props.i18nPort,
        savePort: props.savePort,
        guards: engineGuards,
        extensions: props.extensions,
      }),
    );
    bindEngine(getEngine());
    media.audioRenderer = media.createRenderer();
    media.videoRenderer = media.createVideo();
    speaker.value = "";
    text.value = "";
    shownText.value = "";
    canAdvance.value = false;
    inMenu.value = false;
    inWait.value = false;
    inInput.value = false;
    inVideo.value = false;
    inMinigame.value = false;
    readMinigameHost()?.replaceChildren();
    menuPrompt.value = "";
    inputPrompt.value = "";
    inputValue.value = "";
    error.value = "";
    rawTexts.value = [];
    rawTargets.value = [];
    dialogTemplateName.value = ""; // 重启回全局默认
    currentLang.value = ""; // 引擎状态重建：语言回默认（显示态与运行态一致）
    nvlMode.value = "none";
    nvlBuffer.value = [];
    elements.value = [];
    elementLayerEl.value?.replaceChildren();
    typewriter.set(null);
    getEngine().start();
  }
  return { initEngine, restart, unbind };
}

/**
 * 引擎生命周期的宿主侧装配：构造、订阅接线（state/event 出站到视图与命令面）、
 * 整体重建（restart）与订阅解除（unbind）。
 *
 * 引擎实例本身由装配层持有（`let engine`）：所有消费方经注入的取用句柄拿到当前
 * 实例——重启重建后自动指向新引擎，旧引用不残留。守卫实现来自 stories:build 的
 * cell 生成物（源 = Stories.src/story.ts 的 cell 槽位）——组合根零手写注册；名字
 * 闭合由构建期闸门执法（故事引用属于生成注册表的子集）。
 */

import { watch, type Ref } from "vue";
import {
  SYS,
  StoryEngine,
  type AudioConfig,
  type AudioPort,
  type I18nPort,
  type LayerId,
  type OpExtension,
  type OutboundPayload,
  type SavePort,
  type Story,
  type VideoPort,
} from "@lingfan-engine/core";
import { guards as engineGuards } from "../../stories";
import { playgroundEngineTexts } from "./engine-texts";
import type { AppMedia } from "../stage/media/app-media";
import type { VueNarrativeState } from "../narrative/runtime/narrative-state";
import type { TypewriterHandle } from "../narrative/wiring/app-narrative";

/** 装配入参：宿主属性、装配层句柄与重启时需复位的各单元格 */
export interface AppEngineLifeOptions {
  /** 组合根注入的宿主属性（引擎构造与端口重建消费） */
  props: {
    story: Ref<Story>;
    audioConfig: AudioConfig;
    i18nPort?: I18nPort;
    savePort: SavePort;
    extensions: OpExtension[];
    createAudioPort: (onError: (message: string) => void) => AudioPort;
    createVideoPort: (
      onError: (message: string) => void,
      readContainer?: () => HTMLElement | null,
    ) => VideoPort;
  };
  /** 引擎实例取用（装配层持有 `let engine`，重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 引擎实例整体替换（构造与重启时由装配层调用） */
  setEngine: (engine: StoryEngine) => void;
  /** 媒体单元格（渲染器构造与重启重建） */
  media: AppMedia;
  /** 叙事视图状态（重启时逐字段复位） */
  narrative: VueNarrativeState;
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
  /** 视频层的呈现容器（重启重建端口时同样注入：舞台根 → 视频层随舞台缩放） */
  readVideoContainer?: () => HTMLElement | null;
  /**
   * 挂载表出口：引擎写下 `SYS.mounts` 就把整表交给宿主。
   * 订阅不回放历史，所以绑定时先主动喂一次当前值（空表就是空表）。
   */
  onMounts?: (raw: unknown) => void;
  /**
   * 暂停态出口：引擎写下 `SYS.paused` 就报一次。
   * 挂载 UI 与工具栏都可能直接经操作通道暂停引擎，宿主页面据此同步自己的遮罩；
   * 绑定时同样先喂当前值，避免页面与引擎在重启后各说各话。
   */
  onPaused?: (paused: boolean) => void;
}

/** 引擎生命周期能力：初始化接线、进出对局、fail-closed 后整体重建、订阅解除 */
export interface AppEngineLife {
  /** 组合根初始化：构造引擎、接上订阅与媒体渲染器；不启动——进对局由宿主调 enterGame */
  initEngine: () => void;
  /** 进对局：启动引擎（入口列）并可选跳到指定列；宿主在「开始」时调用 */
  enterGame: (columnId?: string) => void;
  /** 读档继续：从指定槽位恢复进度；宿主在「继续」时调用（须已进对局） */
  continueGame: (slot: string) => void;
  /** fail-closed 停机（引擎报错后拒绝继续）的恢复入口：整体重建引擎 */
  restart: () => void;
  /** 订阅解除（重启与卸载共用；与 bindEngine 成对） */
  unbind: () => void;
}

/** 装配引擎生命周期：构造引擎接线订阅，重启整体重建并复位各单元格 */
export function createAppEngineLife(
  options: AppEngineLifeOptions,
): AppEngineLife {
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
    readVideoContainer,
    onMounts,
    onPaused,
  } = options;
  const {
    speaker,
    text,
    shownText,
    canAdvance,
    inMenu,
    inWait,
    inInput,
    inVideo,
    inMinigame,
    menuPrompt,
    inputPrompt,
    inputCandidates,
    inputValue,
    rawTexts,
    rawTargets,
    dialogTemplateName,
    nvlMode,
    nvlBuffer,
    elements,
  } = narrative;
  let offState: (() => void) | undefined;
  let offEvent: (() => void) | undefined;
  let offMounts: (() => void) | undefined;
  let offPaused: (() => void) | undefined;
  function bindEngine(e: StoryEngine): void {
    offState = e.onStateChanged(handleState);
    offEvent = e.onEvent(handleEvent);
    // 挂载表单独一路：整表是一个值，订阅只认这一个键；先喂当前值再等后续写入
    if (onMounts !== undefined) {
      onMounts(e.get(SYS.mounts));
      offMounts = e.onStateChanged(({ key, value }) => {
        if (key === SYS.mounts) onMounts(value);
      });
    }
    // 暂停态同理：谁按下暂停（Esc、挂载 UI、工具栏）引擎都只写这一个键，
    // 宿主页面据此同步遮罩——页面态不从「是我按的」推断，只从引擎状态读
    if (onPaused !== undefined) {
      onPaused(e.get(SYS.paused) === true);
      offPaused = e.onStateChanged(({ key, value }) => {
        if (key === SYS.paused) onPaused(value === true);
      });
    }
  }
  /** 订阅解除（重启与卸载共用；与 bindEngine 成对） */
  function unbind(): void {
    offState?.();
    offEvent?.();
    offMounts?.();
    offPaused?.();
  }
  function initEngine(): void {
    // SavePort 注入引擎——存档编排（槽位校验/坐标/写读/错误出站）归核心层命令面，
    // UI 只发 save/load 命令并反应完成信号（save.done / load.done）
    setEngine(
      new StoryEngine(props.story.value, {
        audioConfig: props.audioConfig,
        i18nPort: props.i18nPort,
        savePort: props.savePort,
        guards: engineGuards,
        extensions: props.extensions,
        texts: playgroundEngineTexts,
      }),
    );
    bindEngine(getEngine());
    media.audioRenderer = media.createRenderer();
    media.videoRenderer = media.createVideo();
    // 热重载：组合根重新组装后注入新 story → 保运行态（变量/历史）重入当前列
    // 监听 ref 本身（value 变化才触发；() => props.story 监听恒定 Ref 引用 = 永不触发）
    watch(props.story, (fresh) => getEngine().reloadStory(fresh));
  }
  /**
   * 进对局：启动引擎（进入工程入口列），给了列 id 再跳过去。
   * `start()` 本身已进入入口列，所以不传 columnId 时只有一次启动，不重复导航。
   */
  function enterGame(columnId?: string): void {
    const engine = getEngine();
    engine.start();
    if (columnId !== undefined) engine.navigate(columnId);
  }
  /** 读档继续：从槽位恢复进度（须已进对局，否则命令面按「故事尚未启动」拒绝） */
  function continueGame(slot: string): void {
    getEngine().load(slot);
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
    media.videoPort = props.createVideoPort(
      media.reportAudioError,
      readVideoContainer,
    );
    media.videoPort.setZIndex?.(zOf("video")); // 重建端口后补上当前实例 z
    getEngine().dispose();
    setEngine(
      new StoryEngine(props.story.value, {
        audioConfig: props.audioConfig,
        i18nPort: props.i18nPort,
        savePort: props.savePort,
        guards: engineGuards,
        extensions: props.extensions,
        texts: playgroundEngineTexts,
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
    inputCandidates.value = [];
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
  return { initEngine, enterGame, continueGame, restart, unbind };
}

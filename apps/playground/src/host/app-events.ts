/**
 * 事件落点与舞台命令的宿主侧装配：提示条出口、叙事事件分流（提示条/读档诊断/
 * 错误横幅）与三类舞台命令（舞台点击、选项点击、输入提交）。
 *
 * 叙事事件的分流顺序是 App.vue 的接线契约（留在 `handleEvent`），这里只提供
 * 「每条分支做什么」；打字机与输入值都是宿主级共享状态，经注入句柄读写。
 */

import { type Ref } from "vue";
import type { StoryEngine } from "@lingfan/engine";
import { createNarrativeEvents, type NarrativeEvents } from "./narrative-event";
import { createNotices, type Notices } from "./notices";
import type { AppMedia } from "./app-media";
import type { NarrativeState } from "./narrative-state";
import type { TypewriterHandle } from "./app-narrative";

/** 装配入参：叙事状态、媒体单元格、错误横幅、引擎句柄与打字机句柄 */
export interface AppEventsOptions {
  /** 叙事视图状态（等待/输入/正文等响应式字段来源） */
  narrative: NarrativeState;
  /** 媒体单元格（回放/读档后媒体位置对齐） */
  media: AppMedia;
  /** 错误横幅内容（诊断与 fail-closed 上报都落这里） */
  error: Ref<string>;
  /** 引擎句柄取用（命令转发；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 打字机共享句柄（舞台点击的二段式快进） */
  typewriter: TypewriterHandle;
}

/** 事件与输入出口能力：提示条、事件落点、状态同步与舞台输入转发 */
export interface AppEvents {
  /** 提示条列表（模板 v-for 读它） */
  notifications: Notices["items"];
  /** 叙事事件落点（handleEvent 的各分支经它生效） */
  narrativeEvents: NarrativeEvents;
  /** 引擎状态变化 → 叙事视图状态（bindEngine 的 state 订阅回调） */
  handleState: (event: { key: string; value: unknown }) => void;
  /** 回放或读档后，渲染状态与引擎对齐（回溯/读档重写了对话与 NVL 系统键） */
  syncFromEngine: () => void;
  /** 选项点击：目标转交引擎 */
  choose: (target: string) => void;
  /** 输入提交：名字 trim 后转交，并清空输入框 */
  submitInput: () => void;
  /** 舞台点击：打字机二段式（未完成=瞬间完成/越过停顿，完成=advance） */
  onStageClick: () => void;
}

/** 装配事件与输入出口：提示条、叙事事件落点、状态同步与舞台点击转发 */
export function createAppEvents(options: AppEventsOptions): AppEvents {
  const { narrative, media, error, getEngine, typewriter } = options;
  const { canAdvance, inWait, inVideo, inputValue, shownText } = narrative;
  /** 提示条出口：驻留与摘除归共享的宿主层，这里只把列表交给模板 */
  const notices = createNotices();
  /** 提示条列表（模板 v-for 读它） */
  const notifications = notices.items;
  /** 回放或读档后，渲染状态与引擎对齐（回溯/读档重写了对话与 NVL 系统键） */
  function syncFromEngine(): void {
    narrative.syncFromEngine((key) => getEngine().get(key));
  }
  function handleState({ key, value }: { key: string; value: unknown }): void {
    narrative.handleState(key, value);
  }
  /**
   * 事件落点：提示条、读档诊断与错误横幅。
   * 每条分支做什么归 `narrative-event.ts`；分流顺序（哪个分支在前）留在 App.vue。
   */
  const narrativeEvents = createNarrativeEvents({
    notices,
    clearError: () => {
      error.value = "";
    },
    syncFromEngine,
    syncMedia: () => {
      media.audioRenderer?.sync(); // 媒体位置随快照恢复（回滚 seek）
      media.videoRenderer?.sync(); // 视频命令流对齐（回溯到段内 = 重播）
    },
    reportError: (message) => {
      error.value = message;
    },
  });
  /** 打字机二段式点击（未完成=瞬间完成/越过停顿，完成=advance）；仅在对话等待中发 advance */
  function onStageClick(): void {
    if (canAdvance.value) {
      const active = typewriter.get();
      if (active !== null && !active.done) {
        active.click(); // 瞬间完成/越过停顿
        shownText.value = active.visible;
        return;
      }
      getEngine().advance();
    } else if (inWait.value || inVideo.value) {
      getEngine().advance(); // wait 跳过 / cutscene 跳过（skipable 由引擎决定）
    }
  }
  function choose(target: string): void {
    getEngine().choose(target);
  }
  function submitInput(): void {
    getEngine().input(inputValue.value.trim());
    inputValue.value = "";
  }
  return {
    notifications,
    narrativeEvents,
    handleState,
    syncFromEngine,
    choose,
    submitInput,
    onStageClick,
  };
}

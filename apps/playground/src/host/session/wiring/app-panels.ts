/**
 * 面板与视图投影的宿主侧总装：语言选择、模板视图、历史聚合、偏好键位、槽位面板五件事
 * 装成一份。
 *
 * 次序固定：语言与模板先行（模板投影要读叙事状态），历史次之（要拿事件出口的回放同步），
 * 偏好与槽位最后（槽位面板的缩略图摘录取自模板视图）。五者都是「面板皮 + 核心层状态」，
 * 装配本身不碰引擎命令。
 */

import { type Ref } from "vue";
import type { StoryEngine } from "@lingfan-engine/core";
import { createAppLang, type AppLang } from "../../assets/app-lang";
import {
  createAppTemplates,
  type AppTemplates,
} from "../../narrative/wiring/app-templates";
import {
  createAppHistory,
  type AppHistory,
} from "../../panels/wiring/app-history";
import { createAppPrefs, type AppPrefs } from "../../panels/wiring/app-prefs";
import { createAppSlots, type AppSlots } from "../../panels/wiring/app-slots";
import type { AppProps } from "../app-props";
import type { VueNarrativeState } from "../../narrative/runtime/narrative-state";
import type { TypewriterHandle } from "../../narrative/wiring/app-narrative";

/** 装配入参：宿主属性、引擎句柄、叙事状态与面板取用所需的容器 */
export interface AppPanelsOptions {
  /** 组合根注入的宿主属性（只读消费 I18N 供给、存档端口与壳配置） */
  props: AppProps;
  /** 引擎句柄取用（语言切换、历史快照、存读命令；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 叙事视图状态（模板投影的来源） */
  narrative: VueNarrativeState;
  /** NVL 累积层滚动主体取用（对话面板暴露的容器） */
  readNvlBody: () => HTMLElement | null;
  /** 回放后渲染状态与引擎对齐（历史回溯重写了对话与 NVL 系统键） */
  syncFromEngine: () => void;
  /** 舞台根（存档缩略图的真像素合成来源） */
  stageEl: Ref<HTMLElement | null>;
  /** 打字机共享句柄（字速偏好的即时生效落点） */
  typewriter: TypewriterHandle;
}

/** 面板与视图投影能力：语言、模板视图、历史、偏好键位与槽位面板的合并面 */
export interface AppPanels
  extends AppLang, AppTemplates, AppHistory, AppPrefs, AppSlots {}

/** 装配面板与视图投影：语言 → 模板 → 历史 → 偏好 → 槽位 */
export function createAppPanels(options: AppPanelsOptions): AppPanels {
  const { props, getEngine, narrative, syncFromEngine } = options;
  const lang = createAppLang({ props, getEngine });
  const templates = createAppTemplates({
    narrative,
    readNvlBody: options.readNvlBody,
  });
  const history = createAppHistory({ getEngine, syncFromEngine });
  const prefs = createAppPrefs({
    preferences: props.preferences,
    typewriter: options.typewriter,
  });
  const slots = createAppSlots({
    props,
    dialogView: templates.dialogView,
    stageEl: options.stageEl,
    getEngine,
  });
  return { ...lang, ...templates, ...history, ...prefs, ...slots };
}

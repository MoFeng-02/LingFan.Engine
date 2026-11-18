/**
 * 语言选择的宿主侧装配：内部走 shell 宿主语言门面（createHostI18n），
 * 对外保留 Vue ref 显示面并增 `t()`——门面的 currentLang/availableLangs 是
 * 现读 getter（框架无关、非响应式），Vue 模板需要 ref 桥接才能随切换重渲染。
 *
 * 可用语言仍由本装配经 `listLanguages` 扫描（不用门面的缺省列表）：
 * 本参考宿主的选择器语义是「扫描失败 = 空列表 = 选择器不出现」，
 * 与门面「失败保持缺省 [默认语言]」的展示降级不同，故列表自持。
 *
 * 引擎重启会换实例：`bindLang()` 由引擎绑定钩子回调（onBindEngine），
 * 重绑门面订阅并把显示态同步到新引擎实况；`t()` 经 getEngine 现取实例，
 * 先读 currentLang ref 建立响应式依赖——切语言/重启后模板文案即时刷新。
 */

import { ref, type Ref } from "vue";
import type { I18nPort, StoryEngine } from "@lingfan-engine/core";
import { createHostI18n } from "@lingfan-engine/shell";

/** 装配入参：I18N 供给（可选）与引擎句柄取用 */
export interface AppLangOptions {
  /** 组合根注入的宿主属性（只读消费 `i18nPort`） */
  props: {
    /** I18N overlay 供给（可选：未装配 = 原文直出、选择器不出现） */
    i18nPort?: I18nPort;
  };
  /** 引擎句柄取用（切换与显示态读取；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
}

/** 语言选择能力：显示态、可用清单、静态文案查表与切换动作（模板直读） */
export interface AppLang {
  /** 当前显示语言（空串 = 引擎默认；与引擎状态保持一致） */
  currentLang: Ref<string>;
  /** 可用语言清单（空 = 选择器不出现） */
  availableLangs: Ref<string[]>;
  /** 宿主静态文案查表（原文 → 当前语言译文；未命中原样返回） */
  t: (text: string) => string;
  /** 切换语言：按需载入 overlay，落定后回读引擎实况 */
  changeLang: (lang: string) => Promise<void>;
  /** 引擎（重）绑定回调：重绑语言订阅并同步显示态；初始装配也可安全调用 */
  bindLang: () => void;
}

/** 装配语言选择能力：启动时扫描可用语言，切换与查表经门面转发引擎 */
export function createAppLang(options: AppLangOptions): AppLang {
  const { props, getEngine } = options;
  // 门面的引擎适配：四条能力都经 getEngine() 现取——restart 换实例后自动跟随
  const facade = createHostI18n({
    translate: (text) => getEngine().translate(text),
    setLanguage: (lang) => getEngine().setLanguage(lang),
    onStateChanged: (listener) => getEngine().onStateChanged(listener),
    get: (key) => getEngine().get(key),
  });
  const currentLang = ref("");
  const availableLangs = ref<string[]>([]);
  // 扫描失败（资源根缺失等）宽容降级：语言列表保持空 = 选择器不出现（与 command 侧降级同语义）
  void props.i18nPort
    ?.listLanguages?.()
    .then((langs) => {
      if (langs.length > 0) availableLangs.value = langs;
    })
    .catch(() => {});

  let boundEngine: StoryEngine | undefined;
  let unsubscribe: (() => void) | undefined;
  /** 引擎（重）绑定：订阅只挂在当前实例上，换实例先退订再重绑并同步现值 */
  function bindLang(): void {
    const engine = getEngine();
    if (engine === boundEngine) return;
    unsubscribe?.();
    boundEngine = engine;
    unsubscribe = facade.subscribe((lang) => {
      currentLang.value = lang;
    });
    currentLang.value = facade.currentLang.value;
  }

  /** 静态文案查表：先读 ref 建立响应式依赖，再经门面查引擎当前语言译文 */
  function t(text: string): string {
    void currentLang.value;
    return facade.t(text);
  }

  /** 语言切换：门面转 setLanguage 按需载入（失败引擎兜底保持原语言），落定回读实况 */
  async function changeLang(lang: string): Promise<void> {
    await facade.changeLang(lang);
    currentLang.value = facade.currentLang.value;
  }
  return { currentLang, availableLangs, t, changeLang, bindLang };
}

/**
 * 语言选择的宿主侧装配：可用语言来自资源根的 `Lang/` 目录扫描（供给侧 API），
 * 切换经引擎 `setLanguage` 按需载入 overlay。
 *
 * I18N 供给是可选项（浏览器形态可能未装配）：列表扫描失败时宽容降级为空列表，
 * 选择器因此不出现；切换失败由引擎 fail-closed 上报，显示态回退到引擎实况。
 */

import { ref, type Ref } from "vue";
import { SYS, type I18nPort, type StoryEngine } from "@lingfan/engine";

/** 装配入参：I18N 供给（可选）与引擎句柄取用 */
export interface AppLangOptions {
  /** 组合根注入的宿主属性（只读消费 `i18nPort`） */
  props: {
    /** I18N overlay 供给（可选：浏览器形态未装配 = 原文直出） */
    i18nPort?: I18nPort;
  };
  /** 引擎句柄取用（切换与显示态读取；重启重建后指向新实例） */
  getEngine: () => StoryEngine;
}

/** 语言选择能力：显示态、可用清单与切换动作（模板直读） */
export interface AppLang {
  /** 当前显示语言（空串 = 引擎默认；与引擎状态保持一致） */
  currentLang: Ref<string>;
  /** 可用语言清单（空 = 选择器不出现） */
  availableLangs: Ref<string[]>;
  /** 切换语言：按需载入 overlay，落定后回读引擎实况 */
  changeLang: (lang: string) => Promise<void>;
}

/** 装配语言选择能力：启动时扫描可用语言，切换经引擎按需载入 */
export function createAppLang(options: AppLangOptions): AppLang {
  const { props, getEngine } = options;
  // —— 语言选择：可用语言 = Lang/ 目录扫描（供给侧 API）；切换 = setLanguage 按需载入 ——
  const currentLang = ref("");
  const availableLangs = ref<string[]>([]);
  // 扫描失败（资源根缺失等）宽容降级：语言列表保持空 = 选择器不出现（与 command 侧降级同语义）
  void props.i18nPort
    ?.listLanguages?.()
    .then((langs) => {
      if (langs.length > 0) availableLangs.value = langs;
    })
    .catch(() => {});
  /** 语言切换：setLanguage 按需载入 overlay（供给失败引擎 fail-closed 上报，显示态回退） */
  async function changeLang(lang: string): Promise<void> {
    currentLang.value = lang;
    await getEngine().setLanguage(lang);
    if (getEngine().get(SYS.currentLanguage) !== lang) {
      currentLang.value = String(getEngine().get(SYS.currentLanguage) ?? "");
    }
  }
  return { currentLang, availableLangs, changeLang };
}

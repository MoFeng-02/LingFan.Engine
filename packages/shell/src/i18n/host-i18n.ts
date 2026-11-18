/**
 * 宿主语言门面：把「当前语言、可用语言、查译文、切语言、变更通知」收成一处。
 *
 * 门面只是引擎能力的窄投影：查表一律经引擎 `translate`（这里不持有译文表，
 * 也不复制映射——换语言后同一句话立即给出新译文）；切语言一律经引擎
 * `setLanguage`（供给失败保持原语言由引擎兜底，门面不另做回退）。
 *
 * 用法（切换后让当前画面立即生效）：
 * ```ts
 * const i18n = createHostI18n(engine, { i18nPort: port });
 * const title = { value: i18n.t("历史") };
 * i18n.subscribe(() => { title.value = i18n.t("历史"); });
 * await i18n.changeLang("en");
 * ```
 *
 * 注意事项：
 * - `currentLang` 是只读 Cell（任何框架的 ref 结构都兼容），空串 = 默认语言（原文直出）；
 * - `availableLangs` 经宿主注入端口的 `listLanguages` 异步取，取回前/失败时保持缺省列表；
 * - 本模块平台无关：不触碰 DOM、框架与平台 API。
 */
import {
  DEFAULT_LANG,
  SYS,
  type I18nPort,
  type StateListener,
} from "@lingfan-engine/core";
import type { ReadonlyCell } from "../cell";

/**
 * 引擎的窄接口：门面只用到这四条能力（`StoryEngine` 结构兼容，
 * 测试按契约给替身即可，不必构造完整引擎）。
 */
export interface HostI18nEngine {
  /** 查当前语言译文；未命中/未装配译文表时返回原文 */
  translate(text: string): string;
  /** 切换语言（供给失败保持原语言，不抛错） */
  setLanguage(lang: string): Promise<void>;
  /** 状态变更订阅（返回退订函数） */
  onStateChanged(listener: StateListener): () => void;
  /** 读状态键（门面只读当前语言键） */
  get(key: string): unknown;
}

/** 门面的装配输入：语言列表供给由宿主注入（可不给 = 只显默认语言） */
export interface HostI18nOptions {
  /** 语言列表供给端口（只用 `listLanguages`；不传或方法缺省 = ["zh-CN"]） */
  i18nPort?: Pick<I18nPort, "listLanguages">;
}

/** 宿主语言门面：语言选择器与静态文案本地化都从这里取 */
export interface HostI18n {
  /** 当前语言（只读；空串 = 默认语言/原文直出），读时现取引擎状态，不缓存 */
  readonly currentLang: ReadonlyCell<string>;
  /** 可用语言列表（恒含默认语言；供给取回后替换，重读即得最新） */
  readonly availableLangs: readonly string[];
  /** 查译文（原文 → 当前语言译文；未命中原样返回，可安全包住任何静态文案） */
  t(text: string): string;
  /** 切语言（等待供给完成；失败保持原语言，错误经引擎事件出站） */
  changeLang(lang: string): Promise<void>;
  /** 语言变更订阅（回调收到新语言；订阅者重取 `t()` 即刷新画面），返回退订 */
  subscribe(listener: (lang: string) => void): () => void;
}

/** 归一语言列表：只留字符串、去重、恒含默认语言（供给方漏报也不缺省项） */
function normalizeLangs(reported: readonly string[]): readonly string[] {
  const langs = [...new Set(reported.filter((l) => typeof l === "string"))];
  return langs.includes(DEFAULT_LANG) ? langs : [DEFAULT_LANG, ...langs];
}

/**
 * 创建宿主语言门面。引擎必传；语言列表供给可选——缺省只显默认语言，
 * 宿主接上 `listLanguages` 后列表异步补齐（失败保持缺省，不阻塞语言切换）。
 */
export function createHostI18n(
  engine: HostI18nEngine,
  options: HostI18nOptions = {},
): HostI18n {
  let langs: readonly string[] = [DEFAULT_LANG];
  const port = options.i18nPort;
  if (port?.listLanguages) {
    void port.listLanguages().then(
      (reported) => {
        langs = normalizeLangs(reported);
      },
      () => {
        // 列表供给失败只影响可选项展示：保持缺省列表，切语言与查表不受影响
      },
    );
  }

  const currentLang: ReadonlyCell<string> = {
    get value(): string {
      const lang = engine.get(SYS.currentLanguage);
      return typeof lang === "string" ? lang : "";
    },
  };

  return {
    currentLang,
    get availableLangs(): readonly string[] {
      return langs;
    },
    t(text: string): string {
      return engine.translate(text);
    },
    changeLang(lang: string): Promise<void> {
      return engine.setLanguage(lang);
    },
    subscribe(listener: (lang: string) => void): () => void {
      return engine.onStateChanged((change) => {
        if (change.key === SYS.currentLanguage) listener(currentLang.value);
      });
    },
  };
}

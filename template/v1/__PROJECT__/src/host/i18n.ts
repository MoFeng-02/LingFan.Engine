/**
 * 宿主 i18n 装配：译文供给端口 + 语言选择器 + 静态文案重画。
 *
 * 分工：引擎负责**故事内容**的翻译（切语言时派生键自动重译出站）；
 * 本模块只管**宿主自己的静态文案**——工具条按钮、加载占位这些写在页面与
 * 宿主代码里的字面量，经门面 `t()` 查表，语言切换时重画。
 *
 * 供给形态：浏览器与桌面壳都走 Web fetch（`Lang/` 是 publicDir 静态资源，
 * Tauri WebView 同样可取——桌面壳 Rust 侧未注册 i18n 命令，不接 Tauri 端口）。
 * 小程序壳不走这里：它用可注入 `HttpFetch` 的 HTTP 形态（见 `mp/host.ts`）。
 *
 * 装配序：**端口先于引擎**（引擎构造要收 `i18nPort`，`setLanguage` 按需取件）；
 * 门面与选择器在引擎之后接线（门面现读引擎状态，订阅引擎出站）。
 */
import { DEFAULT_LANG, type I18nPort } from "@lingfan-engine/core";
import {
  createFetchI18nPort,
  type I18nLangEntry,
} from "@lingfan-engine/adapters";
import type { HostI18n } from "@lingfan-engine/shell";
import type { DialogueView } from "./dialogue-view";
import type { HistoryPanel } from "./panels/history";
import type { PreferencesPanel } from "./panels/preferences";
import type { StageDom } from "./stage-dom";

/**
 * 造宿主译文供给端口（Web fetch 形态）：构建期语言清单 → 运行期按需取件。
 * `langs` 来自 `virtual:lang-list`（磁盘事实）；空清单 = 只有默认语言原文直出。
 */
export function createHostI18nPort(langs: readonly I18nLangEntry[]): I18nPort {
  return createFetchI18nPort({ langs });
}

/** 语言接线所需的零件：门面（引擎之后建）+ 要重画的视图与面板（都可缺省） */
export interface HostI18nWiringOptions {
  /** 常驻节点句柄表（语言选择器与存档标签都是可选句柄，缺了降级不报错） */
  dom: StageDom;
  /** shell 宿主语言门面（`createHostI18n(engine, { i18nPort })` 的产物） */
  i18n: HostI18n;
  /** 译文供给端口：`listLanguages` 纯清单派生（无网络），用来补齐选择器选项 */
  i18nPort: I18nPort;
  /** 对话视图：切语言后重建选项区（确定钮 / 等待提示随之重画） */
  dialogue: DialogueView;
  /** 偏好面板（可缺省）：切语言后重挂载，通道名与行标签随之重画 */
  prefsPanel?: PreferencesPanel;
  /** 历史面板（可缺省）：切语言后重挂载（收起态重来，按钮文案随之重画） */
  historyPanel?: HistoryPanel;
}

/** 语言接线句柄：dispose 退订门面与选择器事件（幂等由装配处保证只调一次） */
export interface HostI18nWiring {
  dispose(): void;
}

/**
 * 把语言选择器与静态文案接到门面上。
 *
 * 选择器口径：默认语言（`DEFAULT_LANG`）映射 `value=""`——引擎契约里空串 =
 * 原文直出，**不能**传语言码本身（那会尝试加载默认语言的 overlay 目录，缺目录即 fail-closed）。
 * 其余语言按码直选；选项标签用语言码本身（它是数据，不是要翻译的文案）。
 */
export function wireHostI18n(options: HostI18nWiringOptions): HostI18nWiring {
  const { dom, i18n, i18nPort, dialogue, prefsPanel, historyPanel } = options;
  const t = i18n.t;

  /** 宿主静态文案落 DOM：工具条三件 + 存档标签（页面初始「加载中……」只在装配时译一次） */
  function applyStaticTexts(): void {
    dom.save.textContent = t("存");
    dom.load.textContent = t("读");
    if (dom.saveLabel != null) dom.saveLabel.textContent = t("存档");
  }
  // 装配期页面还停在「加载中……」占位：译一次即可，之后正文归引擎管，不再碰
  dom.text.textContent = t("加载中……");
  applyStaticTexts();

  /** 选择器选项重填：当前选中值保持（清单补齐不改变玩家已选的语言） */
  function renderLangOptions(): void {
    const select = dom.lang;
    if (select == null) return;
    const selected = select.value;
    select.replaceChildren();
    for (const lang of i18n.availableLangs) {
      const option = document.createElement("option");
      // 默认语言映射空串（原文直出）；其余语言按码直选
      option.value = lang === DEFAULT_LANG ? "" : lang;
      option.textContent = lang;
      select.appendChild(option);
    }
    select.value = selected;
  }
  renderLangOptions();
  // 门面的 availableLangs 由 listLanguages 异步补齐（纯清单派生，无网络）：
  // 补齐后再填一次选项；失败保持缺省列表，选择器照常可用。
  // listLanguages 在契约里可选——覆盖端口没实现时门面自己保持缺省清单
  void i18nPort.listLanguages?.().then(
    () => renderLangOptions(),
    () => undefined,
  );

  const select = dom.lang ?? null;
  const onChange = (): void => {
    if (select === null) return;
    void i18n.changeLang(select.value).catch((error: unknown) => {
      // fail-closed：引擎保持原语言并报错，这里把原因写进错误条供排查
      dom.error.textContent = `切换语言失败：${String(error)}`;
    });
  };
  select?.addEventListener("change", onChange);

  /** 语言真的变了（引擎出站）：回写选择器 + 重画宿主静态文案 */
  const unsubscribe = i18n.subscribe((lang) => {
    if (select !== null) select.value = lang;
    applyStaticTexts();
    // 选项区整体重建：确定钮 / 等待提示是宿主字面量，重建时经 t() 重查；
    // 菜单与输入提示是故事内容，引擎已派生重译，这里只是重新取一遍
    dialogue.setMenuChanged();
    // 面板重挂载 = 用新语言重建全部行标签（幂等：destroy 后可再 mount）。
    // 历史面板随之回到收起态——切换语言是低频操作，收起比保留旧语言的展开列表简单
    prefsPanel?.destroy();
    prefsPanel?.mount();
    historyPanel?.destroy();
    historyPanel?.mount();
  });

  return {
    dispose(): void {
      unsubscribe();
      select?.removeEventListener("change", onChange);
    },
  };
}

/**
 * 偏好面板（纯 DOM）：四通道音量 + 静音 + 文字速度，以及主音量/文本/显示扩展组。
 *
 * 读写一律经 `PlayerPreferences`——钳制、非法值忽略都在偏好层，本模块只做两件事：
 * 把偏好快照画到控件上，把控件事件翻译成偏好写入。所以换掉这套原生 DOM 不影响偏好语义。
 * 扩展组（主音量/即时文本/NVL 页容量/转场/抖动/减弱动效/字号/对话框外观/元素填充，
 * 及缓办字段禁用占位）在 `preferences-display`，行构件共用 `preferences-dom`。
 *
 * 用法：调用方给一个容器（通常来自 `index.html`），`mount()` 建控件并订阅偏好变化，
 * `destroy()` 清空容器并退订。原生 DOM 没有框架卸载钩子，解绑必须自己成对做，
 * 否则面板关掉后每次改偏好还会去写已卸下的节点。
 *
 * 注意：面板必须落在 `data-ui-zone` 里——输入作用域靠这个属性把面板内的滚轮/按键
 * 判成「控件输入」，否则滚动音量滑杆会连带触发故事回溯。容器由调用方提供，
 * 不能假定它已标记，故 `mount()` 给容器与面板根节点都补上。
 */

import type { AudioChannel, PlayerPreferences } from "@lingfan-engine/core";
import { prefsRow, sliderValue } from "./preferences-dom";
import {
  buildPreferenceExtras,
  type PreferenceExtras,
} from "./preferences-display";

/** 音量通道与显示名；顺序即面板行序 */
export const PREF_CHANNELS: ReadonlyArray<{
  channel: AudioChannel;
  label: string;
}> = [
  { channel: "bgm", label: "BGM" },
  { channel: "se", label: "音效" },
  { channel: "ambient", label: "环境" },
  { channel: "voice", label: "语音" },
];

/** 文字速度滑杆的上下限（字/秒；下限 1 与偏好层的下限一致） */
const TEXT_SPEED_MIN = 1;
const TEXT_SPEED_MAX = 80;

/** 面板当前应显示的视图值（纯数据，测试断言这一层） */
export interface PreferencesPanelView {
  volumes: Record<AudioChannel, number>;
  muted: boolean;
  textSpeed: number;
  /** 固定四通道的展示序 */
  channels: readonly AudioChannel[];
}

/** 偏好面板的输入 */
export interface PreferencesPanelOptions {
  /** 偏好端口（读写与订阅都走它） */
  preferences: PlayerPreferences;
  /** 面板根节点（由调用方给，本模块不自己 append 到 body） */
  container: HTMLElement;
  /**
   * 宿主静态文案查表（可选）：缺省恒等 = 原文直出（不接 i18n 时行为与旧版全同）。
   * 通道名 / 静音 / 文字速度 / 字速单位都是宿主自己的字面量，走查表；
   * 数值读数是数据，不查表。
   */
  translate?: (text: string) => string;
}

/** 偏好面板出口 */
export interface PreferencesPanel {
  /** 面板当前应显示的视图值；每次现读偏好快照 */
  view(): PreferencesPanelView;
  /** 挂载控件与监听（重复调用幂等，不叠控件） */
  mount(): void;
  /** 卸载：退订并清空容器；之后可再次 `mount()` */
  destroy(): void;
}

/** 单行音量控件的引用：同步视图时按通道回填 */
interface VolumeRow {
  channel: AudioChannel;
  input: HTMLInputElement;
  readout: HTMLElement;
}

/**
 * 创建偏好面板。构造只持有端口，不碰 DOM——`mount()` 才建控件，
 * 因此未挂载的面板可以安全地只调 `view()`（视图计算与 DOM 解耦）。
 */
export function createPreferencesPanel(
  options: PreferencesPanelOptions,
): PreferencesPanel {
  const preferences = options.preferences;
  const container = options.container;
  const t = options.translate ?? ((text: string): string => text);

  /** 非 null = 已挂载；同时充当退订句柄（挂载判定与退订成对，避免重复订阅） */
  let off: (() => void) | null = null;
  let volumeRows: VolumeRow[] = [];
  let mutedInput: HTMLInputElement | null = null;
  let textSpeedInput: HTMLInputElement | null = null;
  let textSpeedReadout: HTMLElement | null = null;
  let extras: PreferenceExtras | null = null;

  function view(): PreferencesPanelView {
    const snapshot = preferences.snapshot();
    return {
      volumes: snapshot.volumes,
      muted: snapshot.muted,
      textSpeed: snapshot.textSpeed,
      channels: PREF_CHANNELS.map((entry) => entry.channel),
    };
  }

  /** 把当前偏好画到控件上（挂载时与每次偏好变化时调用） */
  function sync(): void {
    const snapshot = preferences.snapshot();
    for (const row of volumeRows) {
      const volume = snapshot.volumes[row.channel];
      row.input.value = String(volume);
      // 静音时滑杆禁用：此时通道偏好仍保留，只是合成末端归零，拖它看不出效果
      row.input.disabled = snapshot.muted;
      row.readout.textContent = `${Math.round(volume * 100)}%`;
    }
    if (mutedInput !== null) mutedInput.checked = snapshot.muted;
    if (textSpeedInput !== null) {
      textSpeedInput.value = String(snapshot.textSpeed);
    }
    if (textSpeedReadout !== null) {
      textSpeedReadout.textContent = `${Math.round(snapshot.textSpeed)} ${t("字/秒")}`;
    }
    if (extras !== null) extras.sync();
  }

  /**
   * 通道展示名：字面量写在这里而不是查 `entry.label`——i18n 扫描器只认
   * 字面量首参，`t(entry.label)` 是动态调用，键收不进 overlay 清单。
   * `PREF_CHANNELS` 的 `label` 保留原文，作缺省（不接 i18n）时的展示值。
   */
  function channelLabel(channel: AudioChannel): string {
    switch (channel) {
      case "bgm":
        return t("BGM");
      case "se":
        return t("音效");
      case "ambient":
        return t("环境");
      case "voice":
        return t("语音");
    }
  }

  function buildVolumeRows(root: HTMLElement): void {
    for (const entry of PREF_CHANNELS) {
      const input = document.createElement("input");
      input.type = "range";
      input.className = "prefs-range";
      // 通道标在节点上：样式与后续宿主接线都按通道取控件，不靠子节点下标
      input.dataset.channel = entry.channel;
      input.min = "0";
      input.max = "1";
      input.step = "0.05";
      input.addEventListener("input", () => {
        preferences.setVolume(entry.channel, sliderValue(input));
      });
      const readout = document.createElement("span");
      readout.className = "prefs-value";
      root.appendChild(prefsRow(channelLabel(entry.channel), input, readout));
      volumeRows.push({ channel: entry.channel, input, readout });
    }
  }

  function buildMutedRow(root: HTMLElement): void {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "prefs-checkbox";
    input.dataset.setting = "muted";
    input.addEventListener("change", () => {
      preferences.setMuted(input.checked);
    });
    root.appendChild(prefsRow(t("静音"), input));
    mutedInput = input;
  }

  function buildTextSpeedRow(root: HTMLElement): void {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "prefs-range";
    input.dataset.setting = "text-speed";
    input.min = String(TEXT_SPEED_MIN);
    input.max = String(TEXT_SPEED_MAX);
    input.step = "1";
    input.addEventListener("input", () => {
      preferences.setTextSpeed(sliderValue(input));
    });
    const readout = document.createElement("span");
    readout.className = "prefs-value";
    root.appendChild(prefsRow(t("文字速度"), input, readout));
    textSpeedInput = input;
    textSpeedReadout = readout;
  }

  function mount(): void {
    if (off !== null) return; // 已挂载：幂等，重复调用不重复建控件
    container.dataset.uiZone = "";
    const root = document.createElement("section");
    root.className = "prefs-panel";
    root.dataset.uiZone = "";
    buildVolumeRows(root);
    buildMutedRow(root);
    buildTextSpeedRow(root);
    extras = buildPreferenceExtras(root, preferences, t);
    container.appendChild(root);
    sync(); // 先按当前偏好铺初值，再订阅——避免挂载瞬间被一次多余通知重画
    off = preferences.onChange(sync);
  }

  function destroy(): void {
    if (off !== null) {
      off();
      off = null;
    }
    container.textContent = "";
    volumeRows = [];
    mutedInput = null;
    textSpeedInput = null;
    textSpeedReadout = null;
    extras = null;
  }

  return { view, mount, destroy };
}

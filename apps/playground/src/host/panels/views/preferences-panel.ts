/**
 * 偏好面板的宿主侧装配：把面板要读写的字段收成一处。
 *
 * 偏好状态本身归核心层（`PlayerPreferences`），这里只维护一份**响应式镜像**——模板读
 * 镜像才会在偏好变化时重渲染；写入一律经偏好端口，镜像由变更回调同步。
 *
 * 面板只写偏好，落壳（屏幕方向、全屏）归组合根：组件不碰平台桥接。
 */
import { ref, type Ref } from "vue";
import type {
  AudioChannel,
  DialoguePosition,
  ElementFit,
  OrientationMode,
  PlayerPreferences,
  PlayerPrefsData,
  TextSpeedSource,
} from "@lingfan-engine/core";

/** 音量通道与显示名；顺序即面板里的行顺序 */
export const PREF_CHANNELS: ReadonlyArray<{
  channel: AudioChannel;
  label: string;
}> = [
  { channel: "bgm", label: "BGM" },
  { channel: "se", label: "音效" },
  { channel: "ambient", label: "环境" },
  { channel: "voice", label: "语音" },
];

/** 偏好面板的输入 */
export interface PreferencesPanelOptions {
  /** 偏好端口（读写与订阅都走它） */
  preferences: PlayerPreferences;
  /** 偏好变化后的附加动作（字速要即时作用于当前句） */
  onChanged?(): void;
}

/** 偏好面板出口：模板读 `view` 与 `channels`，控件事件交给对应 setter */
export interface PreferencesPanel {
  /** 偏好快照的响应式镜像 */
  readonly view: Ref<PlayerPrefsData>;
  /** 音量通道表（面板行） */
  readonly channels: ReadonlyArray<{ channel: AudioChannel; label: string }>;
  /** 音量滑杆 */
  setVolume(channel: AudioChannel, event: Event): void;
  /** 静音开关 */
  setMuted(event: Event): void;
  /** 字速滑杆 */
  setTextSpeed(event: Event): void;
  /** 屏幕方向下拉（空值 = 清除 = 跟随工程默认） */
  setOrientation(event: Event): void;
  /** 全屏开关 */
  setFullscreen(event: Event): void;
  /** 主音量滑杆（渲染层经 effectiveVolume 自动乘入） */
  setMasterVolume(event: Event): void;
  /** 即时显示文本开关 */
  setInstantText(event: Event): void;
  /** NVL 每页行数滑杆 */
  setNvlPageSize(event: Event): void;
  /** 转场速度倍率滑杆 */
  setTransitionSpeed(event: Event): void;
  /** 抖动强度滑杆 */
  setShakeScale(event: Event): void;
  /** 减弱动效下拉（空值 = 清除 = 跟随系统） */
  setReducedMotion(event: Event): void;
  /** 字号倍率滑杆 */
  setFontScale(event: Event): void;
  /** 对话框不透明度滑杆 */
  setDialogueOpacity(event: Event): void;
  /** 对话框位置下拉（空值 = 清除 = 跟随作者样式） */
  setDialoguePosition(event: Event): void;
  /** 对话框高度倍率滑杆 */
  setDialogueHeightScale(event: Event): void;
  /** 元素填充默认下拉（空值 = 清除 = 跟随内建） */
  setElementFit(event: Event): void;
  /** 自动播放开关（开启后宿主按 autoDelayMs 节奏推进对话） */
  setAutoEnabled(event: Event): void;
  /** 自动播放延时滑杆（打字机完成后距上次推进至少等这么久） */
  setAutoDelayMs(event: Event): void;
  /** 快进遇未读即停开关（关闭则快进越过未读文本） */
  setSkipUnseenOnly(event: Event): void;
  /** 字体下拉（空值 = 清除 = 跟随工程默认） */
  setFontFamily(event: Event): void;
  /** 字速源下拉（空值 = 清除 = 玩家优先） */
  setTextSpeedSource(event: Event): void;
  /** 退订偏好变更（组件卸载期调用，与构造成对） */
  dispose(): void;
}

/**
 * 创建偏好面板。构造即订阅偏好变更，模板拿到的 `view` 始终跟着端口走。
 */
export function createPreferencesPanel(
  options: PreferencesPanelOptions,
): PreferencesPanel {
  const preferences = options.preferences;
  const view = ref(preferences.snapshot());
  const off = preferences.onChange(() => {
    view.value = preferences.snapshot();
    options.onChanged?.();
  });

  return {
    view,
    channels: PREF_CHANNELS,
    setVolume(channel: AudioChannel, event: Event): void {
      preferences.setVolume(
        channel,
        Number((event.target as HTMLInputElement).value),
      );
    },
    setMuted(event: Event): void {
      preferences.setMuted((event.target as HTMLInputElement).checked);
    },
    setTextSpeed(event: Event): void {
      preferences.setTextSpeed(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setOrientation(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") {
        preferences.clearOrientation();
        return;
      }
      preferences.setOrientation(value as OrientationMode);
    },
    setFullscreen(event: Event): void {
      preferences.setFullscreen((event.target as HTMLInputElement).checked);
    },
    setMasterVolume(event: Event): void {
      preferences.setMasterVolume(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setInstantText(event: Event): void {
      preferences.setInstantText((event.target as HTMLInputElement).checked);
    },
    setNvlPageSize(event: Event): void {
      preferences.setNvlPageSize(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setTransitionSpeed(event: Event): void {
      preferences.setTransitionSpeed(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setShakeScale(event: Event): void {
      preferences.setShakeScale(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setReducedMotion(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") {
        preferences.clearReducedMotion();
        return;
      }
      preferences.setReducedMotion(value === "on");
    },
    setFontScale(event: Event): void {
      preferences.setFontScale(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setDialogueOpacity(event: Event): void {
      preferences.setDialogueOpacity(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setDialoguePosition(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") {
        preferences.clearDialoguePosition();
        return;
      }
      preferences.setDialoguePosition(value as DialoguePosition);
    },
    setDialogueHeightScale(event: Event): void {
      preferences.setDialogueHeightScale(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setElementFit(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") {
        preferences.clearElementFit();
        return;
      }
      preferences.setElementFit(value as ElementFit);
    },
    setAutoEnabled(event: Event): void {
      preferences.setAutoEnabled((event.target as HTMLInputElement).checked);
    },
    setAutoDelayMs(event: Event): void {
      preferences.setAutoDelayMs(
        Number((event.target as HTMLInputElement).value),
      );
    },
    setSkipUnseenOnly(event: Event): void {
      preferences.setSkipUnseenOnly((event.target as HTMLInputElement).checked);
    },
    setFontFamily(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") {
        preferences.clearFontFamily();
        return;
      }
      preferences.setFontFamily(value);
    },
    setTextSpeedSource(event: Event): void {
      const value = (event.target as HTMLSelectElement).value;
      if (value === "") {
        preferences.clearTextSpeedSource();
        return;
      }
      preferences.setTextSpeedSource(value as TextSpeedSource);
    },
    dispose(): void {
      off();
    },
  };
}

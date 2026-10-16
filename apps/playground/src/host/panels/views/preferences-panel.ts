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
  OrientationMode,
  PlayerPreferences,
  PlayerPrefsData,
} from "@lingfan/engine";

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

/** 偏好面板出口：模板读 `view` 与 `channels`，控件事件交给五个 setter */
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
    dispose(): void {
      off();
    },
  };
}

/**
 * 玩家偏好的宿主侧装配：状态归核心层（PlayerPreferences），面板只是 UI 皮。
 * 镜像与五个 setter 在偏好面板叶子；键位映射 = 偏好覆盖（prefs-keymap）× 内建默认
 * （DEFAULT_KEYMAP），匹配与捕获在键位面板叶子。
 *
 * 「字速即时作用于当前句」在这里接线：偏好变化回调对当前打字机调 `setSpeed`，
 * 下一句重建时自然取新值。
 */

import { ref, type Ref } from "vue";
import {
  SYS,
  resolveTextSpeed,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import { DEFAULT_TEXT_CPS, type TypingSetting } from "@lingfan-engine/ui";
import {
  createKeybindingPanel,
  type KeybindingPanel,
} from "../views/keybinding-panel";
import {
  createPreferencesPanel,
  type PreferencesPanel,
} from "../views/preferences-panel";
import type { TypewriterHandle } from "../../narrative/wiring/app-narrative";

/** 装配入参：玩家偏好、引擎句柄与打字机句柄（字速即时生效落点） */
export interface AppPrefsOptions {
  /** 玩家偏好（组合根装配：hydrate 后注入，与存档分离） */
  preferences: PlayerPreferences;
  /** 引擎句柄取用（读故事级打字机设置，字速三级链的「故事」一级） */
  getEngine: () => StoryEngine;
  /** 打字机共享句柄（字速即时生效的落点） */
  typewriter: TypewriterHandle;
}

/** 偏好面板能力：显隐、视图镜像、各偏好写入口与键位捕获 */
export interface AppPrefs {
  /** 偏好面板显隐 */
  showPrefs: Ref<boolean>;
  /** 偏好快照的响应式镜像（模板读它，才会在偏好变化时重渲染） */
  prefsView: PreferencesPanel["view"];
  /** 音量通道表（面板行） */
  PREF_CHANNELS: PreferencesPanel["channels"];
  /** 音量滑杆 */
  setPrefVolume: PreferencesPanel["setVolume"];
  /** 静音开关 */
  setPrefMuted: PreferencesPanel["setMuted"];
  /** 字速滑杆 */
  setPrefTextSpeed: PreferencesPanel["setTextSpeed"];
  /** 屏幕方向下拉（空值 = 清除 = 跟随工程默认；落壳归组合根） */
  setPrefOrientation: PreferencesPanel["setOrientation"];
  /** 全屏开关 */
  setPrefFullscreen: PreferencesPanel["setFullscreen"];
  /** 捕获中的动作（null = 不在捕获态） */
  captureAction: KeybindingPanel["captureAction"];
  /** 按键匹配（大小写不敏感）——装配层以 `keyMatches` 名字消费，调用形态（先问域、再问键）不变 */
  keyMatches: KeybindingPanel["matches"];
  /** 进入捕获态 */
  startCapture: KeybindingPanel["startCapture"];
  /** 复位某个动作的键位（回内建默认） */
  resetKeybinding: KeybindingPanel["resetKeybinding"];
  /** capture 阶段键位捕获（优先于普通键位处理） */
  onCaptureKeydown: KeybindingPanel["handleCaptureKey"];
  /** 键位显示文本（空格与单字符的写法） */
  displayKeys: KeybindingPanel["displayKeys"];
  /** 偏好面板句柄（卸载期退订偏好变更用） */
  prefs: PreferencesPanel;
}

/** 装配偏好与键位面板：状态归核心层，这里只出视图镜像与写入口 */
export function createAppPrefs(options: AppPrefsOptions): AppPrefs {
  const { preferences, getEngine, typewriter } = options;
  const showPrefs = ref(false);
  const prefs = createPreferencesPanel({
    preferences,
    onChanged: () => {
      // 字速即时生效于当前句：与每句重建同走三级链（偏好 > 故事 > 兜底）。
      // 归属为 story 时滑杆只改偏好、不覆盖当前句的作者字速（解析口径单一事实源）。
      const setting = getEngine().get(SYS.typewriter) as
        TypingSetting | undefined;
      const cps = resolveTextSpeed({
        player: preferences.textSpeed,
        source: preferences.textSpeedSource,
        story: setting?.speed,
        fallback: DEFAULT_TEXT_CPS,
      });
      typewriter.get()?.setSpeed(cps);
    },
  });
  const keys = createKeybindingPanel({
    preferences,
    readKeymap: () => prefs.view.value.keymap,
  });
  return {
    showPrefs,
    prefsView: prefs.view,
    PREF_CHANNELS: prefs.channels,
    setPrefVolume: prefs.setVolume,
    setPrefMuted: prefs.setMuted,
    setPrefTextSpeed: prefs.setTextSpeed,
    setPrefOrientation: prefs.setOrientation,
    setPrefFullscreen: prefs.setFullscreen,
    captureAction: keys.captureAction,
    keyMatches: keys.matches,
    startCapture: keys.startCapture,
    resetKeybinding: keys.resetKeybinding,
    onCaptureKeydown: keys.handleCaptureKey,
    displayKeys: keys.displayKeys,
    prefs,
  };
}

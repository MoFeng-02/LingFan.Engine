/**
 * 玩家偏好的宿主侧装配：状态归核心层（PlayerPreferences），面板只是 UI 皮。
 * 镜像与全部偏好 setter 在偏好面板叶子：主面板控件经此转发，扩展控件直拿句柄；
 * 键位映射 = 偏好覆盖（prefs-keymap）× 内建默认（DEFAULT_KEYMAP），匹配与捕获在键位面板叶子。
 *
 * 「字速即时作用于当前句」在这里接线：偏好变化回调对当前打字机调 `setSpeed`，
 * 下一句重建时自然取新值。auto/skip 节奏控制也归这里：偏好是自动播放的
 * 单一事实源，工具条快捷按钮与键盘快进共用同一装配。
 */

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import {
  SYS,
  resolveTextSpeed,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import {
  DEFAULT_TEXT_CPS,
  type AutomatedAdvanceLoop,
  type TypingSetting,
} from "@lingfan-engine/ui";
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
  /** 宿主静态文案查表（原文 → 当前语言）；键位面板的键名显示用它 */
  t?: (text: string) => string;
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
    t: options.t,
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

/** 节奏装配入参：循环、引擎取用、偏好与复装所需的响应式状态 */
export interface AppAutoSkipOptions {
  /** skip/auto 节奏循环（展示层单一实现） */
  loop: AutomatedAdvanceLoop;
  /** 引擎句柄取用（restart 换实例，取用永远指向当前实例） */
  getEngine: () => StoryEngine;
  /** 玩家偏好（autoEnabled 的单一事实源） */
  preferences: PlayerPreferences;
  /** 是否在对局中 */
  inGame: Ref<boolean>;
  /** 偏好快照的响应式镜像（Auto 高亮读它） */
  prefsView: PreferencesPanel["view"];
  /** 当前显示文本（叙事变动信号） */
  shownText: Ref<string>;
  /** 是否可推进（叙事变动信号） */
  canAdvance: Ref<boolean>;
  /** 重启（整体换引擎实例） */
  restart: () => void;
}

/** 工具条 Auto/Skip 能力：高亮态、切换入口与模式变动信号 */
export interface AppAutoSkip {
  /** Auto 高亮 = 玩家意图（偏好 autoEnabled 镜像） */
  autoOn: ComputedRef<boolean>;
  /** Skip 高亮 = 引擎快进运行态 */
  skipActive: ComputedRef<boolean>;
  /** 翻自动播放偏好（与偏好面板同一事实源） */
  toggleAuto(): void;
  /** 起停快进（与按住 Ctrl 同一事实源） */
  toggleSkip(): void;
  /** 重启：先停旧实例上的节奏，换完按偏好重新装配 */
  onRestart(): void;
  /** 宿主主动切换模式（键盘按住/松开）的信号：触发高亮与复装复查 */
  notifyModeChange(): void;
  /** 退订偏好变更并停观察器（卸载期调用，与构造成对） */
  dispose(): void;
}

/**
 * 装配 auto/skip 节奏控制：状态归引擎会话旗标与偏好，这里只出高亮镜像与切换入口。
 * 引擎 auto/skip 旗标是会话态（不进快照），没有独立订阅面：借叙事态的响应式触发
 * 复查，modeTick 补宿主主动切换的信号。读档/回溯/重启清掉会话模式后，syncAuto
 * 对当前实例重新断言 auto(true)——restart 换实例仍跟得上。
 */
export function createAppAutoSkip(options: AppAutoSkipOptions): AppAutoSkip {
  const {
    loop,
    getEngine,
    preferences,
    inGame,
    prefsView,
    shownText,
    canAdvance,
    restart,
  } = options;
  const modeTick = ref(0);
  const skipActive = computed(() => {
    void modeTick.value;
    void shownText.value;
    void canAdvance.value;
    return getEngine().skipActive();
  });
  // Auto 高亮读偏好单一事实源：高亮 = 玩家意图（armed）；节奏循环在未读/noskip 处
  // 自停后随下一次叙事变动复装，意图不改
  const autoOn = computed(() => prefsView.value.autoEnabled === true);
  /** 自动播放只在「进了对局 + 偏好开启」时起；快进运行中让位，引擎旗标已在则不重复装配 */
  function syncAuto(): void {
    if (!inGame.value || !preferences.autoEnabled) {
      loop.stopAuto();
      return;
    }
    if (getEngine().skipActive() || getEngine().autoActive()) return;
    loop.stopAuto();
    loop.startAuto();
  }
  const offAutoPrefs = preferences.onChange(syncAuto);
  const stops = [
    watch(inGame, syncAuto),
    // 叙事变动（含读档/回溯/重启的视图重置）与宿主模式切换都触发复查
    watch([shownText, canAdvance, modeTick], syncAuto),
  ];
  syncAuto();
  return {
    autoOn,
    skipActive,
    toggleAuto(): void {
      preferences.setAutoEnabled(!preferences.autoEnabled);
    },
    toggleSkip(): void {
      if (getEngine().skipActive()) loop.stopSkip();
      else loop.startSkip();
      modeTick.value += 1;
    },
    onRestart(): void {
      loop.stopSkip();
      loop.stopAuto();
      restart();
      modeTick.value += 1;
      syncAuto();
    },
    notifyModeChange(): void {
      modeTick.value += 1;
    },
    dispose(): void {
      offAutoPrefs();
      for (const stop of stops) stop();
    },
  };
}

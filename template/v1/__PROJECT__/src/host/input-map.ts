/**
 * 模板输入映射：把玩家的点击 / 按键 / 滚轮翻译成引擎动作。
 *
 * 三条纪律在这里成面：
 * - **键位读偏好**：推进 / 历史键逐次现读玩家改绑（`preferences.keybinding`），缺席落回内建默认；
 *   不在构造期抄成闭包常量，否则改绑后不生效。
 * - **域路由**：点击 / 滚轮 / 按键先经 `routesToNarrative`——只有「对话域 + 非控件目标」才归叙事，
 *   于是 `data-ui-zone` 里的面板控件、输入框自己消费事件，不会被推进键穿透。
 * - **单一收尾**：所有监听挂在同一个 `AbortController` 上，拆除时一次 `abort()` 全退，
 *   不在多处分别 `removeEventListener`（那样容易漏退一条，推进键就此永久失效）。
 *
 * 菜单 / 输入 / 玩法等「非对话等待」中推进无效（`ADVANCEABLE_WAITING` 白名单）；
 * 打字机未打完时推进键先补完当前句，再下一次才推进剧情。
 */
import {
  DEFAULT_KEYMAP,
  SYS,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import {
  createInputScopeState,
  matchesKeybinding,
  routesToNarrative,
  type InputScopeState,
} from "@lingfan-engine/ui";
import type { StageDom } from "./stage-dom";
import type { DialogueView } from "./dialogue-view";

/** 输入接线的输入 */
export interface HostInputOptions {
  dom: StageDom;
  engine: StoryEngine;
  dialogue: DialogueView;
  /** 玩家偏好：推进 / 历史键逐次现读改绑；缺省用内建默认键位 */
  preferences?: PlayerPreferences;
  /** 输入域：缺省对话域；玩法接管时由宿主切到 world / ui，叙事键随之让位 */
  inputScope?: InputScopeState;
  /** 历史键（默认 h）触发的面板开合 */
  onHistory?: () => void;
  /** Esc 触发的关面板 */
  onClosePanels?: () => void;
  /** Ctrl / Cmd + S 快速存档 */
  onQuickSave?: () => void;
  /** Ctrl / Cmd + L 快速读档 */
  onQuickLoad?: () => void;
}

/** 允许「推进」的等待态：对话 / 显式等待 / 视频。菜单 / 输入 / 玩法等不在内，推进无效 */
const ADVANCEABLE_WAITING = new Set(["dialog", "wait", "video"]);

/**
 * 接好输入监听，返回拆除函数（一次 `abort()` 退掉全部监听）。
 */
export function wireInput(options: HostInputOptions): () => void {
  const { dom, engine, dialogue } = options;
  const scope = options.inputScope ?? createInputScopeState();
  const controller = new AbortController();
  const { signal } = controller;

  function advance(): void {
    const typewriter = dialogue.readTypewriter();
    if (typewriter !== null && !typewriter.done) {
      typewriter.click();
      return;
    }
    const waiting = engine.get(SYS.waiting);
    if (typeof waiting === "string" && ADVANCEABLE_WAITING.has(waiting)) {
      engine.advance();
    }
  }

  // 点击推进：只在对话域且目标不是面板控件 / 输入框
  dom.viewport.addEventListener(
    "click",
    (event) => {
      if (!routesToNarrative(scope.current(), event.target)) return;
      advance();
    },
    { signal },
  );

  // 交互层自己消费点击，不冒泡到舞台触发推进
  for (const node of [dom.choices, dom.toolbar, dom.notifications]) {
    node.addEventListener("click", (event) => event.stopPropagation(), {
      signal,
    });
  }

  // 滚轮：上滚回溯、下滚前进（同样先经域路由）
  dom.viewport.addEventListener(
    "wheel",
    (event) => {
      if (!routesToNarrative(scope.current(), event.target)) return;
      if (event.deltaY < 0) engine.back();
      else if (event.deltaY > 0) engine.forward();
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (!routesToNarrative(scope.current(), event.target)) return;

      // Ctrl / Cmd + S / L 快速存读：先于推进键判定，避免被 advance 吞掉
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "s" && options.onQuickSave !== undefined) {
          event.preventDefault();
          options.onQuickSave();
          return;
        }
        if (key === "l" && options.onQuickLoad !== undefined) {
          event.preventDefault();
          options.onQuickLoad();
          return;
        }
      }

      if (
        matchesKeybinding(
          options.preferences?.keybinding("advance"),
          DEFAULT_KEYMAP.advance,
          event,
        )
      ) {
        event.preventDefault();
        advance();
      } else if (
        matchesKeybinding(
          options.preferences?.keybinding("history"),
          DEFAULT_KEYMAP.history,
          event,
        )
      ) {
        options.onHistory?.();
      } else if (event.key === "Escape") {
        options.onClosePanels?.();
      }
    },
    { signal },
  );

  return () => controller.abort();
}

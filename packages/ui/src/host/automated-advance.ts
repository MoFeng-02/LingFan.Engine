/**
 * skip / auto 的宿主节奏装配（单一实现，三宿主共用）。
 *
 * 引擎只管模式旗标与守卫（`auto`/`skip`/`advanceAutomated`），「按什么节奏推进」是宿主的事：
 * - **快进（skip）= 按住持续**：起一个按 `skipDelayMs` 节奏的循环，每拍先补完打字机再
 *   `advanceAutomated`；守卫命中（noskip、未读停、回溯期、ui 列）返回 false 即停。
 * - **自动（auto）= 偏好开关**：`autoEnabled` 开启后小步轮询，打字机打完且距上次推进够
 *   `autoDelayMs` 才自动推进；快进时让位。
 *
 * 两者都走引擎 guarded 推进接缝，检查点时机与玩家点击一致。节奏参数逐拍现读偏好，
 * 改滑杆即时生效。本模块零 DOM：打字机经读面注入，定时器用全局 `setInterval`。
 */
import {
  SYS,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";

/** 打字机的最小读面：是否打完 + 补完当前句 */
export interface TypewriterReader {
  done: boolean;
  click(): void;
}

/** 节奏装配的输入 */
export interface AutomatedAdvanceOptions {
  /** 现读当前引擎（宿主重启会换实例，故用读面而非定值） */
  getEngine: () => StoryEngine;
  /** 现读当前打字机（无打字机返回 null） */
  readTypewriter: () => TypewriterReader | null;
  /** 玩家偏好：节奏参数 + skipUnseenOnly + autoEnabled；缺省用内建默认 */
  preferences?: PlayerPreferences;
}

/** 节奏循环句柄 */
export interface AutomatedAdvanceLoop {
  startSkip(): void;
  stopSkip(): void;
  startAuto(): void;
  stopAuto(): void;
  /** 一次退掉两个循环（宿主收尾调用） */
  dispose(): void;
}

/** 造一个 skip/auto 节奏循环（不自动启动，由宿主按键位 / 偏好触发） */
export function createAutomatedAdvanceLoop(
  options: AutomatedAdvanceOptions,
): AutomatedAdvanceLoop {
  const engine = options.getEngine;
  let skipTimer: ReturnType<typeof setInterval> | null = null;
  let autoTimer: ReturnType<typeof setInterval> | null = null;
  let autoLastAdvance = 0;

  function stopSkip(): void {
    if (skipTimer !== null) {
      clearInterval(skipTimer);
      skipTimer = null;
      engine().skip(false);
    }
  }

  function startSkip(): void {
    if (skipTimer !== null) return;
    engine().skip(true);
    const delay = options.preferences?.skipDelayMs ?? 50;
    skipTimer = setInterval(() => {
      const typewriter = options.readTypewriter();
      if (typewriter !== null && !typewriter.done) typewriter.click();
      if (
        !engine().advanceAutomated({
          skipUnseenOnly: options.preferences?.skipUnseenOnly ?? false,
        })
      ) {
        stopSkip();
      }
    }, delay);
  }

  function stopAuto(): void {
    if (autoTimer !== null) {
      clearInterval(autoTimer);
      autoTimer = null;
      engine().auto(false);
    }
  }

  function startAuto(): void {
    if (autoTimer !== null) return;
    engine().auto(true);
    autoLastAdvance = Date.now();
    autoTimer = setInterval(() => {
      if (options.preferences?.autoEnabled !== true) {
        stopAuto();
        return;
      }
      if (engine().skipActive()) return;
      // 自动播放只推进对话（等待 / 视频不自动跳，交给玩家或快进）
      if (engine().get(SYS.waiting) !== "dialog") return;
      const typewriter = options.readTypewriter();
      if (typewriter !== null && !typewriter.done) return;
      const delay = options.preferences?.autoDelayMs ?? 1500;
      if (Date.now() - autoLastAdvance < delay) return;
      if (engine().advanceAutomated()) autoLastAdvance = Date.now();
      else stopAuto();
    }, 100);
  }

  return {
    startSkip,
    stopSkip,
    startAuto,
    stopAuto,
    dispose(): void {
      stopSkip();
      stopAuto();
    },
  };
}

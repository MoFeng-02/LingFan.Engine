/**
 * skip / auto 的宿主节奏装配（单一实现，三宿主共用）。
 *
 * 引擎只管模式旗标与守卫（`auto`/`skip`/`advanceAutomated`），「按什么节奏推进」是宿主的事：
 * - **快进（skip）= 按住持续**：起一个按 `skipDelayMs` 节奏的循环，每拍先补完打字机再
 *   `advanceAutomated`；守卫命中（noskip、未读停、回溯期、ui 列）返回 false 即停。
 * - **自动（auto）= 偏好开关**：`autoEnabled` 开启后小步轮询，打字机打完且本句停留够了
 *   才自动推进；快进时让位。**停留时长按句长算**：`autoDelayMs` 是基础停留，
 *   再按该句词元量 / `autoReadCps` 追加阅读时间——长句停得久、短句停得短。
 *
 * 两者都走引擎 guarded 推进接缝，检查点时机与玩家点击一致。节奏参数逐拍现读偏好，
 * 改滑杆即时生效。本模块零 DOM：打字机经读面注入，定时器用全局 `setInterval`。
 */
import {
  SYS,
  type PlayerPreferences,
  type StoryEngine,
} from "@lingfan-engine/core";
import { autoDwellMs, countReadingTokens } from "../dialogue/reading-pace.ts";

/** 打字机的最小读面：是否打完 + 补完当前句 + 本句词元量 */
export interface TypewriterReader {
  done: boolean;
  click(): void;
  /**
   * 本句的阅读词元量（自动播放按它分摊停留）。
   *
   * 读面做成可选：宿主可以晚一步接上（缺省时退回按引擎里那条正文现数），
   * 早期宿主的旧实现不会因多一个必填字段而编译不过。
   */
  readingTokens?: number;
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

  /** 当前对话正文（引擎里的镜像值）；非字符串按空串处理 */
  function readDialogText(): string {
    const value = engine().get(SYS.currentDialogText);
    return typeof value === "string" ? value : "";
  }

  /**
   * 本句词元量：优先用打字机读面给的数（它构造时分过词，口径与渲染一致）；
   * 读面还没接上（无打字机或旧实现）时退回按引擎里那条正文现数。
   */
  function readTokens(
    sentence: string,
    typewriter: TypewriterReader | null,
  ): number {
    const tokens = typewriter?.readingTokens;
    if (typeof tokens === "number" && Number.isFinite(tokens)) return tokens;
    return countReadingTokens(sentence);
  }

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
    // 停留计时以「这一句打完」为起点，而不是上一次推进：否则打字机慢慢打完的那几秒
    // 会白白抵掉阅读时间，长句反而比短句停得少。
    let autoSentence = "";
    let autoTypedAt = -1;
    autoTimer = setInterval(() => {
      if (options.preferences?.autoEnabled !== true) {
        stopAuto();
        return;
      }
      if (engine().skipActive()) return;
      // 自动播放只推进对话（等待 / 视频不自动跳，交给玩家或快进）
      if (engine().get(SYS.waiting) !== "dialog") return;
      const sentence = readDialogText();
      if (sentence !== autoSentence) {
        autoSentence = sentence;
        autoTypedAt = -1;
      }
      const typewriter = options.readTypewriter();
      const typed = typewriter === null || typewriter.done;
      if (!typed) return;
      if (autoTypedAt < 0) autoTypedAt = Date.now();
      const dwell = autoDwellMs({
        tokens: readTokens(sentence, typewriter),
        readCps: options.preferences?.autoReadCps ?? 12,
        baseMs: options.preferences?.autoDelayMs ?? 1500,
      });
      if (Date.now() - autoTypedAt < dwell) return;
      if (engine().advanceAutomated()) {
        // 下一句重新计时（文本可能同值，靠显式复位而不是靠比对）
        autoSentence = "";
        autoTypedAt = -1;
      } else {
        stopAuto();
      }
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

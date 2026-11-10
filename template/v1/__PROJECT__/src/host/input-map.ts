/**
 * 输入映射：点击与键盘（空格 / 回车）都汇到同一个 `advance`。
 *
 * 「点击能否推进」按等待态判定：只有对话 / 可跳过的等待 / 可跳过的过场这三态把点击
 * 映射成 `advance`；菜单、输入、小游戏等交互等待期**不映射**——那些状态的推进出口是
 * 各自的选择与提交，舞台空白处的点击不该被解释成「继续」。
 *
 * 这层判定不能省：引擎对非对话等待的 `advance` 是 fail-closed（发 `advance-invalid`
 * 并写进错误条），而错误条一旦出现就不会自己消失——玩家在菜单上多点两下舞台就会看到
 * 一条红字。是否可跳过（`wait` / `video` 的 skipable）仍归引擎裁决，这里只按等待态
 * 放行，不放行就什么也不做。
 *
 * 两处刻意的不推进：交互层（选项 / 工具条 / 通知）内的点击不推进故事（元素可交互节点
 * 在渲染器内自行 `stopPropagation`，这里再兜一层），输入框内的空格 / 回车不吞键
 * （那是玩家在打字）。
 */

import { SYS, type StoryEngine } from "@lingfan-engine/core";
import type { StageDom } from "./stage-dom";
import type { DialogueView } from "./dialogue-view";

/** 输入映射的输入：节点句柄表、引擎推进面与对话视图 */
export interface HostInputOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 引擎：推进命令面的落地 */
  engine: StoryEngine;
  /** 对话视图：打字机未打完时先让打字机瞬间完成 */
  dialogue: DialogueView;
}

/** 把点击映射成 `advance` 的等待态：对话、可跳过的等待、可跳过的过场 */
const ADVANCEABLE_WAITING: ReadonlySet<unknown> = new Set([
  "dialog",
  "wait",
  "video",
]);

/** 接线点击与键盘 */
export function wireInput(options: HostInputOptions): void {
  const { dom, engine, dialogue } = options;

  /** 二段式推进：打字未完 → 瞬间完成 / 越过停顿；否则推进故事 */
  function advance(): void {
    const typewriter = dialogue.readTypewriter();
    if (typewriter !== null && !typewriter.done) {
      typewriter.click();
      return;
    }
    // 非可推进等待态直接返回：引擎会 fail-closed 并在错误条上留一条永不消失的红字
    if (!ADVANCEABLE_WAITING.has(engine.get(SYS.waiting))) return;
    engine.advance();
  }

  // 点击落在视口上而不是舞台上：等比装入留下的留边也该算命中（点空白处推进对话），
  // 而舞台根被缩放后量到的只是内容区
  dom.viewport.addEventListener("click", advance);
  for (const el of [dom.choices, dom.toolbar, dom.notifications]) {
    el.addEventListener("click", (event) => event.stopPropagation());
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      if (event.target instanceof HTMLInputElement) return; // 输入框内不吞键
      event.preventDefault();
      advance();
    }
  });
}

/**
 * 输入映射：点击与键盘（空格 / 回车）都汇到同一个 `advance`。
 *
 * 语义归核心层——`advance` 自己处理可跳过性、非等待态与 fail-closed，这里只做映射，
 * 不判断「现在能不能推进」。
 *
 * 两处刻意的不推进：交互层（选项 / 工具条 / 通知）内的点击不推进故事（元素可交互节点
 * 在渲染器内自行 `stopPropagation`，这里再兜一层），输入框内的空格 / 回车不吞键
 * （那是玩家在打字）。
 */

import type { StoryEngine } from "@lingfan/engine";
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
    engine.advance();
  }

  dom.root.addEventListener("click", advance);
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

/**
 * 第六章 · 小游戏与交互站：两种玩法系统分流进文本创作列（.story），证明 TS 流与文本流共存可达。
 * interaction("walk") 成功进 text_gallery（元素画廊，elementFit 对比）；minigame("click3") 成功进
 * text_tale（文本故事）。onSuccess 是 plain-string 分流（ctx.enterColumn 按列 id 进列），不走字面量跳转闸。
 * journal.flag 状态键（config state 树声明，初值 0）做一次性相位标记：首访走交互，画廊回来再走小游戏，避免重复分流。
 */
import { script } from "@lingfan-engine/editor";

const { interaction, jump, minigame, reward, say, set } = script;

import { moodNeutral, moodThinking, portraitNeutral } from "../lib/portraits";

export default function feat_play(): void {
  portraitNeutral();
  say(
    "小游戏与交互站：玩法系统分流进文本创作列，演示 TS 流与文本流共存可达。",
    "灵泛",
  );
  if (state.journal.flag === 0) {
    set("journal.flag", 1);
    moodThinking();
    say(
      "先体验交互 walk：用 A/D 或方向键走到终点，成功进入文本画廊列 text_gallery。",
      "灵泛",
    );
    interaction("walk", { config: { target: 120 }, onSuccess: "text_gallery" });
  }
  moodThinking();
  say(
    "再体验小游戏 click3：点够 3 次，成功进入文本故事列 text_tale（金币 +10）。",
    "灵泛",
  );
  minigame("click3", {
    config: { target: 3 },
    reward: [reward("player.gold", "{player.gold + 10}")],
    onSuccess: "text_tale",
  });
  moodNeutral();
  say("两种分流演示完毕。", "灵泛");
  jump("feat_hub");
}

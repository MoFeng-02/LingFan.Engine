/** 第二章 · 广场列：staticFor 构建期展开热身三行 → click3 小游戏（通关金币 +10）→ jump 收束。 */
import { script } from "@lingfan/editor";

const { minigame, reward, say, staticFor, jump } = script;

export default function square(): void {
  staticFor(3, (i) => [
    say(`热身第 ${i + 1} 组：甩了甩手腕（构建期 staticFor 生成）。`, "旁白"),
  ]);
  say("广场上只有风声。");
  minigame("click3", {
    config: { target: 3 },
    reward: [reward("player.gold", 10)],
  });
  say("你活动了一下手腕（小游戏演示完成，金币 +10）。");
  jump("end");
}

/**
 * 第四章 · 流程厨房：switch / while + break·continue / for-of 全部语句化（编译为
 * switchOn / whileDo / for 运行期 op，显式种子 ⇒ 回溯确定性）；forEach 保留词逃生舱。
 * 站尾 jump 接收导入的故事引用——编译期解析为列 id。
 */
import { forEach, newArray, random, say } from "../lib/vocabulary";
import tourStory from "./tour";
import { jump, state } from "../lib/compile-time";

export default function tour_flow(): void {
  say(
    "流程厨房——随机、多路分支、循环与循环控制全是运行期 op（显式种子 ⇒ 回溯确定性）。",
    "灵泛",
  );
  random(2026, 1, 6, "dice");
  say("掷骰（种子 2026，回溯重放同点数）：{dice} 点。");
  switch (state.dice) {
    case 1:
      say("一点——运气垫底，正适合从头再来。");
      break;
    case 6:
      say("六点——大吉！今晚酒钱我出。");
      break;
    default:
      say("{dice} 点，中规中矩。");
  }
  let n = 0;
  while (n < 3) {
    n += 1;
    if (n === 2) continue;
    say(`报数 {n}（while + continue：2 被跳过）`);
  }
  let m = 0;
  while (m < 99) {
    m += 1;
    if (m >= 3) break;
    say(`冲刺 {m}（break 在 3 收步）`);
  }
  newArray("supplies", ["火把", "面包", "旧地图"]);
  for (const item of state.supplies) {
    say(`for 迭代：${item}`);
  }
  forEach("thing", "supplies", [say(`foreach 迭代：{thing}`)]);
  say(
    "两站同料双炊：for-of 吃 state 路径、foreach 词按名取集合——产物都是静态 op 序列。",
  );
  say("本站用 jump 导入故事引用回菜单（编译期解析为列 id）。");
  jump(tourStory);
}

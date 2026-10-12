/**
 * 第一章 · 序幕列（列 id = default 导出函数名）：bgm / 状态复合赋值 / 插值 / input /
 * if-else + 嵌套函数（func+call）/ wait / NVL / cutscene / 守卫 / 菜单，一章内集中亮相。
 */
import {
  bgm,
  character,
  cutscene,
  guard,
  input,
  menu,
  notify,
  nvl,
  option,
  say,
  se,
  wait,
  地点,
} from "../lib/vocabulary";
import { checkGold } from "../lib/guards";
import { state } from "../lib/compile-time";
import { Sex } from "../lib/state";

/** 列体嵌套函数：编译期前置到列头 func 命令，调用点发射 call（运行期真子程序）。 */
function greet(who: string): void {
  say(`${who}，欢迎来到灵泛！`, who);
}

export default function start(): void {
  bgm("Audio/crickets_night01.mp3", { volume: 0.4, fade: 1200 });
  state.player.gold += 20;
  state.player.sex = Sex.Male;
  character("灵泛", { name: "灵泛", color: "#7aa2f7" });
  say("你有 {player.gold:000} 枚金币（插值 + 补零格式化）。", "灵泛");
  say(
    "富文本：{b}加粗{/b}、{i}斜体{/i}、{u}下划线{/u}、{color=#FFD700}金色{/color}、{color=#9ece6a}{size=22}大字{/size}{/color}。",
  );
  input("旅人，报上名来：", "player.name");
  if (state.player.gold >= 25) {
    notify("金币充足！当前 {player.gold} 枚。", { type: "info" });
    greet(state.player.name);
  } else {
    say("囊中羞涩……先去赚点钱吧。");
  }
  wait(1.5, { skipable: true });
  say("（等待 1.5 秒可点击跳过）");
  se("Audio/chest_drawer_open.mp3", { volume: 0.7 });
  nvl("enter");
  say("NVL 累积：第一段。");
  say("第二段（滚动累积）。");
  say("第三段。");
  nvl("exit");
  say("NVL 退出，回到普通对话。");
  cutscene("Video/m1.mp4", { volume: 0.8, skipable: false, z: 1450 });
  say("过场结束——播完或点击跳过都会继续。");
  guard(checkGold);
  menu("接下来去哪里？", [
    option("酒馆", 地点.酒馆),
    option("广场", 地点.广场),
    option("元素舞台", 地点.元素舞台),
    option("TS 能力", 地点.TS能力),
    option("词汇全席", "tour"),
  ]);
}

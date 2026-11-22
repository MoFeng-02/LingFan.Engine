/**
 * 第一章 · 序幕列（列 id = default 导出函数名）：引擎门面的叙事开场。
 * 灵泛引导旅人——背景 + 立绘 + 主题乐与夜虫环境层 + 选择分支，自然展示
 * say / character / menu / 元素 / 音频 / 插值 / input / if-else + 嵌套函数（func+call）。
 * 纯数值算术回归演示见第四章 tour_vars（词汇全席可达）。
 */
import { script } from "@lingfan-engine/editor";

const {
  ambient,
  animate,
  background,
  bgm,
  character,
  cutscene,
  guard,
  input,
  menu,
  mount,
  notify,
  nvl,
  option,
  say,
  se,
  style,
  wait,
} = script;

import { hub } from "../../gen/ui_register.g";
import { checkGold } from "../lib/guards";
import { Sex, 地点 } from "../lib/enums";
import {
  moodAngry,
  moodNeutral,
  moodSerious,
  moodShy,
  moodThinking,
  portraitNeutral,
} from "../lib/portraits";

/** 列体嵌套函数：编译期前置到列头 func 命令，调用点发射 call（运行期真子程序）。 */
function greet(who: string): void {
  say(`${who}，欢迎来到灵泛！`, who);
}

export default function start(): void {
  // 开场门面：夜色大厅作背景，灵泛立绘居右淡入，主题乐循环 + 夜虫环境层独立循环。
  character("灵泛", { name: "灵泛", color: "#7aa2f7" });
  background("Images/hall.svg");
  portraitNeutral();
  style("lingfan", { opacity: 0 });
  animate("lingfan", "opacity", 1, { duration: 1.2, easing: "EaseOutQuad" });
  bgm("Audio/bgm_theme.wav", { volume: 0.5, fade: 1500, loop: true });
  ambient("Audio/crickets_night01.mp3", {
    volume: 0.35,
    fade: 1200,
    loop: true,
  });
  // 常驻状态栏：挂上就一直在，`props` 整份替换（再 mount 一次即换文案）
  mount(hub, true, { label: "进度", value: "序幕" });

  state.player.sex = Sex.Male;
  say("夜风穿过大厅，灯火摇曳。灯影里，一个身影向你走来。");
  say("旅人，你终于到了。我是灵泛，这台引擎的引路人。", "灵泛");
  say("这里的一草一木、一声一息，都由命令与状态织成——且听我慢慢道来。", "灵泛");

  moodThinking();
  input("旅人，报上名来：", "player.name");
  state.player.gold += 20;
  if (state.player.gold >= 25) {
    moodShy();
    notify("金币充足！当前 {player.gold} 枚。", { type: "info" });
    greet(state.player.name);
    moodNeutral();
  } else {
    moodAngry();
    say("囊中羞涩……先去赚点钱吧。");
    moodNeutral();
  }
  say(
    "这是给你的盘缠：{player.gold:000} 枚金币（插值 + 补零格式化）。",
    "灵泛",
  );
  say(
    "富文本也能入戏：{b}加粗{/b}、{i}斜体{/i}、{u}下划线{/u}、{color=#FFD700}金色{/color}、{color=#9ece6a}{size=22}大字{/size}{/color}。",
    "灵泛",
  );
  se("Audio/se_ui_confirm.wav", { volume: 0.6 });

  moodSerious();
  nvl("enter");
  say("灵泛：这台引擎以状态为唯一事实源，命令驱动一切呈现。");
  say("灵泛：对话、立绘、音频、选择，皆是可回溯、可存档的数据。");
  say("灵泛：愿你在此看见引擎的全貌，也看见故事的温柔。");
  nvl("exit");
  moodNeutral();

  say("让我为你放一段世界的剪影。", "灵泛");
  cutscene("Video/m1.mp4", { volume: 0.8, skipable: true, z: 1450 });
  say("过场结束——播完或点击跳过都会继续。", "灵泛");
  wait(1.0, { skipable: true });
  se("Audio/se_whoosh.wav", { volume: 0.5 });
  guard(checkGold);
  moodThinking();
  menu("接下来去哪里？", [
    option("酒馆", 地点.酒馆),
    option("广场", 地点.广场),
    option("元素舞台", 地点.元素舞台),
    option("TS 能力", 地点.TS能力),
    option("功能演示", "feat_hub"),
    option("词汇全席", "tour"),
    option("沙盒地图（沙盒 demo）", "world"),
  ]);
}

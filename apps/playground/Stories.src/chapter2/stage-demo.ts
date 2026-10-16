/**
 * 第二章 · 元素舞台列：新范式纯命令流——原 scene 列的 elements[] 面板不再由故事源承载，
 * 元素能力（show/animate/style/setZ/shake/transition/bgSwitch）全部经词函数发射运行期 op。
 */
import { script } from "@lingfan/editor";

const { animate, bgSwitch, hide, say, setZ, show, shake, style, transition } =
  script;

export default function stage_demo(): void {
  say("这里是元素舞台——人物、特效与转场全部由命令 op 承载。", "灵泛");
  say("依次执行：追加元素 → 淡入动画 → 样式与层级调整 → 屏幕震动 → 全屏转场。");
  show("Images/lingfan.png", {
    id: "hero",
    name: "cast",
    x: 40,
    y: 120,
    background: false,
  });
  animate("hero", "opacity", 0.9, { duration: 1, easing: "EaseOutQuad" });
  style("hero", { color: "#9ece6a" });
  setZ("hero", 30);
  shake({ intensity: 6, duration: 0.4 });
  transition("fade", 0.6);
  say("完成：样式已改绿、层级已提升，追加的图已淡入。");
  hide("cast");
  say("按 name 批量隐藏（cast 组）已完成，可看到图消失。");
  bgSwitch("Images/lingfan.png");
  say("背景已切换（bg_switch）。回「开始故事」列可继续。");
}

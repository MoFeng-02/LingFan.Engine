/**
 * 第四章 · 舞台窗口：背景 + 对话窗开合 + 单元素 animate_block + 打字机开关 + notify 角标。
 */
import { script } from "@lingfan/editor";

const {
  animateBlock,
  background,
  dialogWindow,
  hide,
  notify,
  say,
  show,
  textTypewriter,
} = script;

import { stationsMenu } from "../lib/stations";

export default function tour_stage(): void {
  say("舞台窗口——背景与对话窗都是 op 层的舞台资产，故事按名开关。", "灵泛");
  background("Images/lingfan.png");
  say("background 换底图。");
  dialogWindow("hide");
  notify("对话窗已隐藏（dialog_window hide），正文走全屏舞台。", {
    type: "info",
  });
  say("这句仍照常推进——列命令流不受窗口开合影响。");
  dialogWindow("show");
  say("对话窗回到台前。");
  show("Images/lingfan.png", { id: "tour_block", x: 180, y: 120 });
  animateBlock("tour_block", {
    x: 420,
    y: 180,
    opacity: 0.8,
    duration: 1.2,
    easing: "EaseOutQuad",
  });
  say("animate_block 一次做完移动/淡入/时长/缓动（单元素块动画）。");
  textTypewriter({ enabled: false });
  say("打字机关掉后，这句是整段浮出（对比下面一句）。");
  textTypewriter({ enabled: true, speed: 30 });
  say("打字机以每秒 30 字符的速度逐字上屏——两段体感不同。");
  hide("tour_block");
  stationsMenu();
}

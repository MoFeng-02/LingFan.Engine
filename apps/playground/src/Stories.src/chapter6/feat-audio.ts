/**
 * 第六章 · 音频实例多轨站：四通道（bgm/se/ambient/voice）+ 实例维度用足。
 * 实例可多轨叠加、各自独立音量/暂停/恢复；se 一次性触发不进实例。
 * voice 用既有素材占位演示通道（真配音缓办）；打字音 se_type 一次性试听（逐字接线缓办）。
 */
import { script } from "@lingfan-engine/editor";

const {
  audioPause,
  audioPlay,
  audioResume,
  audioStop,
  audioVolume,
  jump,
  say,
  se,
} = script;

import { portraitNeutral } from "../lib/portraits";

export default function feat_audio(): void {
  portraitNeutral();
  say(
    "音频实例多轨站。实例是作者点名的编排单元，可多轨叠加、各自独立。",
    "灵泛",
  );
  audioPlay("melody", "bgm", "Audio/bgm_theme.wav", {
    volume: 0.5,
    loop: true,
    fade: 800,
  });
  audioPlay("wind", "ambient", "Audio/ambient_wind.wav", {
    volume: 0.4,
    loop: true,
    fade: 800,
  });
  say(
    "两轨叠加：bgm 实例 melody 与 ambient 实例 wind 同时播放，互不干扰。",
    "灵泛",
  );
  audioVolume("melody", 0.8);
  say("把 melody 单独调到 0.8，wind 不受影响——实例音量独立。", "灵泛");
  audioPause({ inst: "wind" });
  say("只暂停 wind 一轨，melody 继续——实例暂停独立。", "灵泛");
  audioResume({ inst: "wind" });
  say("恢复 wind，从暂停位置续播，不从头重播。", "灵泛");
  se("Audio/se_ui_click.wav", { volume: 0.6 });
  se("Audio/se_ui_confirm.wav", { volume: 0.6 });
  say("se 通道一次性触发：点击音与确认音，不进实例、不可暂停。", "灵泛");
  se("Audio/se_type.wav", { volume: 0.5 });
  say(
    "打字音素材已备（se_type），此处一次性试听；逐字打字接线需宿主钩子，诚实缓办。",
    "灵泛",
  );
  audioPlay("vox", "voice", "Audio/chest_drawer_open.mp3", { volume: 0.6 });
  say("voice 通道实例 vox（既有素材占位演示通道；真配音素材缓办）。", "灵泛");
  audioStop("vox");
  audioStop();
  say("停掉全部实例，声场清空。四通道与实例维度演示完毕。", "灵泛");
  jump("feat_hub");
}

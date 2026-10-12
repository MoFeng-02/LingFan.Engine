/** 第四章 · 存档试吃：autoSave 开关 + 命名档 save + 临时档 saveDelete 的时机演示（编排归引擎命令面，安全归 Rust）。 */
import { script } from "@lingfan/editor";

const { autoSave, notify, say, save, saveDelete } = script;

import { stationsMenu } from "../lib/stations";

export default function tour_save(): void {
  say("存档试吃——存档编排归引擎命令面、安全归 Rust；故事只按名声明。", "灵泛");
  autoSave(true);
  say("auto_save 已开启：从现在起每个等待画面都会自动落检查点档。");
  save("tour_slot", "词汇全席·存档试吃");
  say(
    "本句上屏时「存档试吃」档已写入 tour_slot（save op 在等待画面落档）——右上角「读」可随时回来。",
  );
  save("temp_demo");
  say("临时档 temp_demo 也写了一份（纯演示用）。");
  saveDelete("temp_demo");
  say("save_delete 已删掉临时档——tour_slot 不受影响。");
  notify("存档域演示完毕：试试右上角「存 / 读」。", { type: "success" });
  stationsMenu();
}

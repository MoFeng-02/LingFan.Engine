/**
 * 书房的对话列：内容与结构同 `kitchen_talk`，只是台词与回跳目标不同。
 *
 * 纯流程列（没有 `body`）⇒ 说话时书房画面仍在；真列帧 ⇒ 每句各占一个检查点，
 * 玩家能一句一句退回去。
 */
import { script } from "@lingfan-engine/editor";

const { say, set, jump } = script;

export default function desk_talk(): void {
  say("书页翻到一半，墨迹还湿着。", "研究者");
  say("……灯油该添了。", "研究者");
  set("game.world.lamp", 1);
  jump("room_study");
}

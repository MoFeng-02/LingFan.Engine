/**
 * 厨房的对话列：房间组件 `navigate` 到这一列来「说几句话」。
 *
 * 两条都是引擎的既定语义，作者不需要额外做什么：
 * - **画面不换**：本列是纯流程列（没有 `body`），进它不改画面——上一屏的身体
 *   原样留着，玩家说的这几句话就叠在厨房上面。画面归 `scene` 列管，流程列管不着。
 * - **逐句可退**：本列是真列，列帧自带列坐标，每句 `say` 各占一个检查点，
 *   玩家能一句一句退回去。
 */
import { script } from "@lingfan-engine/editor";

const { say, set, jump } = script;

export default function kitchen_talk(): void {
  say("灶上还温着一锅汤，灯却灭了。", "厨娘");
  say("……我把灯点上吧。", "厨娘");
  set("game.world.lamp", 1);
  jump("room_kitchen");
}

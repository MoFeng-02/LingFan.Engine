/**
 * 厨房：同一份 `scenes/room/room.vue` 换个 bodyProps 就是另一间屋子。
 * 标题与背景图由这里给，组件本身不认识「厨房」这个词。
 *
 * `talkColumn` 指向一条真列，不是组件内的原子对话——开灯要先说一句，
 * 玩家得能逐句退回去（组件里的 `say` 退不回来）。
 */
import { room } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = room;
export const bodyProps = {
  title: "厨房",
  image: "Images/room-kitchen.svg",
  talkColumn: "kitchen_talk",
};

export default function room_kitchen(): void {}

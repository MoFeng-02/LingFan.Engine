/**
 * 书房：与厨房同一份身体，只换标题、背景与对话列。
 * 这条列存在的意义是证明「组件复用靠列声明，不靠组件里的分支」。
 */
import { room } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = room;
export const bodyProps = {
  title: "书房",
  image: "Images/room-study.svg",
  talkColumn: "desk_talk",
};

export default function room_study(): void {}

/** 第一章 · 酒馆列：老板招呼 + 跨文件函数调用（lib/cast.ts 的 farewell）→ jump 收束到终幕。 */
import { script } from "@lingfan-engine/editor";

const { say, jump } = script;

import { farewell } from "../lib/cast";

export default function inn(): void {
  say("欢迎光临，{player.gold} 金币的贵客！", "酒馆老板");
  farewell("酒馆老板");
  jump("end");
}

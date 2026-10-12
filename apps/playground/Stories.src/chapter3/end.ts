/** 尾声列（id: end）：全库 jump("end") 的落点；列尾之后点击不再推进。 */
import { script } from "@lingfan/editor";

const { say } = script;

export default function end(): void {
  say("本列播完——列尾之后点击不再推进。", "灵泛");
  say(
    "（这条结局列也是 Stories.src 的一员：所有 jump/menu 的目标都在编译期解析。）",
  );
}

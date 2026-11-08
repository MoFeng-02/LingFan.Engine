/**
 * 这一列演示挂载界面：`mount(句柄, 显隐, props)`。
 *
 * 界面本体在 `src/ui/hint/hint.vue`——目录名就是 UI 名，故事源默认导入它，
 * 绑定名必须与目录名一致，构建期逐条校验。`props` 整份替换而不是逐字段合并，
 * 值必须 JSON 安全（随快照存档），要操作引擎就走运行期注入的 `controls`。
 */
import { mount, script } from "@lingfan-engine/editor";

import hint from "../../ui/hint/hint.vue";

const { say } = script;

export const columnType = "ui";

export default function look_around(): void {
  mount(hint, true, { text: "提示条从这一列的 mount 调用挂上来" });
  say("你绕着走了一圈，什么也没发生。", "旁白");
  say(
    "提示条是 src/ui/hint/hint.vue，挂载语句在 src/Stories.src/title/look_around.ts。",
    "旁白",
  );
}

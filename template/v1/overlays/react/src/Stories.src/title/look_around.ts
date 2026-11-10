/**
 * 这一列演示挂载界面：`mount(句柄, 显隐, props)`。
 *
 * 界面本体在 `src/ui/hint/hint.tsx`——目录名就是 UI 名，构建期按这个名字校验。
 * 句柄从构建生成物 `src/gen/ui_register.g` 取，而不是从 `hint.tsx` 默认导入：
 * 组件编译器（编辑器的 TSX 语言服务）会把 `.tsx` 解析成真实组件类型，
 * 顶掉 `authoring` 声明的 `UiHandle` 通配，于是 `mount(句柄)` 变成
 * 「组件不能赋给句柄」——只有编辑器红，纯 tsc 却是绿的。
 * `props` 整份替换而不是逐字段合并，值必须 JSON 安全（随快照存档），
 * 要操作引擎就走运行期注入的 `controls`。
 */
import { mount, script } from "@lingfan-engine/editor";

import { hint } from "../../gen/ui_register.g";

const { say } = script;

export const columnType = "ui";

export default function look_around(): void {
  mount(hint, true, { text: "提示条从这一列的 mount 调用挂上来" });
  say("你绕着走了一圈，什么也没发生。", "旁白");
  say(
    "提示条是 src/ui/hint/hint.tsx，挂载语句在 src/Stories.src/title/look_around.ts。",
    "旁白",
  );
}

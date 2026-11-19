/**
 * 组件身体示例列：这一屏由 `src/scenes/hello/` 的组件来画。
 *
 * `body` 指认身体——取的是生成物里的具名句柄（与直接 import 组件折叠出同一个名字），
 * 构建期会核对这个名字真的在 `src/scenes/` 里登记过，查不到当场报错。
 * `bodyProps` 是传给组件的故事值（必须 JSON 安全，存档随行）；组件与引擎交互的
 * 环境（`env`）由宿主在运行期注入，不写在这里。
 *
 * 本列是场景列（`scene`）：命令落 `entry`，整屏交给身体组件。对话层仍盖在身体之上，
 * 所以这里的 `say` 照常显示——身体画背景与交互，台词走对话层，两层各司其职。
 */
import { script } from "@lingfan-engine/editor";
import { hello as helloScene } from "../../gen/scene_register.g";

export const columnKind = "scene";
export const body = helloScene;
export const bodyProps = { greeting: "你好，旅人" };

const { say } = script;

export default function hello_body(): void {
  say("这一屏由组件来画：点「点名」会把次数写进引擎，回溯也带得走。", "旁白");
}

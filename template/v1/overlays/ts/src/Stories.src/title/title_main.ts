/**
 * 入口故事列。
 *
 * 写法与运行时无关：这些函数在构建期被求值成命令序列，产物是
 * `Resources/Stories/title/title_main.json`——引擎运行期读的是产物，不是本文件。
 * 因此本文件可以随便用 TS 的能力（类型、函数、循环、import），只要最终落到
 * `script` 提供的词上。词表与签名由 `@lingfan-engine/editor` 给出，编辑器里能补全。
 *
 * 一个函数就是一列（column）：函数名即列 id。`config.ts` 的 `start` 指向本文件，
 * 所以它是进入故事时执行的第一列。
 */
import { script } from "@lingfan-engine/editor";

/**
 * 本列是界面列（`ui`）：引擎此刻只是「停在某个列上」，而这一列声明的类型告诉宿主
 * 该渲染启动界面而不是舞台。缺省不写即 `game`——所以「是不是界面列」是数据，不是约定。
 */
export const columnType = "ui";

const { menu, option, say } = script;

export default function title_main(): void {
  say("这是用 TypeScript 写的故事列。", "旁白");
  say("改完保存，在工程根跑 pnpm stories:build 就会重新生成故事文件。");
  menu("接下来做什么？", [
    option("四处看看", "look_around"),
    option("重来一次", "title_main"),
  ]);
}

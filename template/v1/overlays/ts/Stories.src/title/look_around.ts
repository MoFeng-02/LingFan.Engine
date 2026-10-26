/**
 * 四处看看：第二列，演示「一个函数就是一列」。
 *
 * 列与列之间靠名字跳转（`menu` 的选项值就是目标列 id），跨文件也可以——
 * 本文件与 `title_main.ts` 同属 `config.ts` 里 `folders` 声明的目录，
 * 因此互相跳转不需要 import。
 */
import { script } from "@lingfan-engine/editor";

const { say } = script;

export default function look_around(): void {
  say("你绕着走了一圈，什么也没发生。", "旁白");
  say("想加点东西，就打开 Stories.src/title/look_around.ts 改写这一列。");
}

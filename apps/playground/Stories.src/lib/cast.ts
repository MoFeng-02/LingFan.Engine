/**
 * 跨文件函数演示模块（纯模块，无 default 导出，不产生故事列）。
 *
 * 模块级函数默认仅本文件可见（TS 原生作用域）；export + import 才能跨文件调用——
 * 编译器把导入函数前置为 func 命令（导入组），调用点发射 call（运行期真子程序）。
 */
import { script } from "@lingfan-engine/editor";

const { say } = script;

/** 酒馆告别词：inn 列演示跨文件函数调用。 */
export function farewell(who: string): void {
  say(`${who}：慢走，路上小心。`);
}

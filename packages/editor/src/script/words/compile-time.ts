/**
 * Script 词汇层 · **编译期构造**：只在 Stories.src 源内有意义，由 stories 构建管线静态展开，
 * 运行期不提供实现（误调用即抛错）。这里只放纯编译期声明与类型，不产 op、不进 op schema。
 */
import type { StoryCommand } from "@lingfan-engine/core";

/** 故事文件的 default 导出引用（jump 跨故事引用等编译期引用形态的目标类型）。 */
export type StoryFn = () => void;

/**
 * 编译期定数循环：`staticFor(n, (i) => [命令…])` 在构建期展开为 n 份按序内联的静态命令，
 * i 以数字字面量代换（含模板串插值）。运行期不可调用。
 *
 * @param count 展开份数（构建期常量）。
 * @param generator 以序号产出命令数组的生成函数（构建期求值）。
 * @returns 展开后的静态命令（只在 Stories.src 源内有意义；误调用即抛错）。
 * @example
 * staticFor(3, (i) => [say(`第 ${i} 次操练`)]);
 */
export function staticFor(
  _count: number,
  _generator: (i: number) => readonly StoryCommand[],
): StoryCommand[] {
  throw new Error(
    "staticFor 是编译期构造：由 stories 构建管线静态展开，运行期不可调用",
  );
}

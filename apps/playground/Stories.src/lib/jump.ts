/**
 * jump 的编译期声明（故事引用形态专用）。
 *
 * 两个通道并存，编译器按绑定形态分派（words.ts），最终发射同一条 jump op：
 * - 列名字符串目标：直接用词汇层词——`const { jump } = script`，列名由 gen 注册表收窄，写错即红；
 * - 导入故事引用（`import tourStory from "./tour"` 后 `jump(tourStory)`）：编辑器词签名只收
 *   列名字面量（KnownColumnName），TS 面须收 `string | (() => void)`，故此处保留 declare 宽类型；
 *   编译器对 declare 绑定按名特判（无体函数声明 → emitJump）。
 */
import type { StoryCommand } from "@lingfan-engine/core";

export declare function jump(target: string | (() => void)): StoryCommand;

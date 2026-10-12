/**
 * 源侧创作垫片（随包 .d.ts）——原 `Stories.src/lib/compile-time.ts` 垫片的包化迁移
 * （设计稿 §三⑤）。三组声明，各管一件事：
 *
 * - `state`：编译器保留根，按名匹配（assign/expr 的 stateRoot），不产生绑定。
 *   此处给宽索引签名（StateRoot），保证消费工程 tsc 通过；工程可用 declare module
 *   收窄（形态 A 用 `InferStateSchema<typeof state>` 推导，形态 B 由
 *   `gen/stories.gen.d.ts` 从合并树生成）。
 * - `jump`：真身通道 = `@lingfan/editor` 词汇层词（词表出口 + emitWordCommand 特判
 *   → emitJump）；本声明只为 IDE/类型检查兜底，不改变运行时通道。
 * - `define` / `defineVars`：config.ts 构建期内建（求值环境注入，无运行时实体）；
 *   全局声明供 config.ts 书写与 tsc 通过。
 */
import type { StoryCommand } from "@lingfan/engine";

export interface StateRoot {
  // 宽索引签名是垫片的本意：在工程收窄（declare module / gen 生成）之前，
  // 消费工程要能直接写 state.player.gold += 20，unknown 做不到这一点。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export declare const state: StateRoot;

export declare function jump(target: string | (() => void)): StoryCommand;

declare global {
  /** 形态 B：点路径或对象字面量声明初始 defines（构建期累积；同键二次定义 fail-closed）。 */
  function define(path: string, value: unknown): void;
  function define(spec: Record<string, unknown>): void;
  /** 变量键声明：返回实参本身（键 = 插值键注册表的 defineKeys 域贡献）。 */
  function defineVars<T extends Record<string, string>>(spec: T): T;
}

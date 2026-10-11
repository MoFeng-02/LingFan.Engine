/**
 * 源侧类型垫片：只放 declare 声明，编译器跳过扫描（不进产物、不产 op）。
 *
 * `state` 是编译器保留根：源里 `state.player.gold` 表示状态路径 player.gold，
 * 编译期下沉为引擎插值/赋值文本，运行期不存在这个标识符。
 * schema 唯一来源 = ./state（interface StoryState）；此处 re-export `state`
 * 绑定保持故事源 import 路径不变（StoryState 类型请从 ./state 导入——
 * 带specifier 的转发导出与类型导出都被构建期 fail-closed 拦截）。
 */
import type { StoryState } from "./state";

export declare const state: StoryState;

/**
 * 跨故事跳转：目标是列名字符串或导入的故事引用（default 导入），编译期统一解析为列 id。
 * declare 宽类型只为 IDE；引擎 jump 词签名收 string，编译器对两种实参走同一 emitJump。
 */
export declare function jump(target: string | (() => void)): import("@lingfan/engine").StoryCommand;

/**
 * 源侧创作垫片（随包 .d.ts）
 * 三组声明，各管一件事：
 *
 * - `state`：编译器保留根，按名匹配（assign/expr 的 stateRoot），不产生绑定。
 *   此处给宽索引签名（StateRoot），保证未接 gen 类型面的工程 tsc 通过；精确类型面
 *   由构建产物 `gen/state.gen.d.ts` 从 config 合并树生成，工程桥文件
 *   `import type { StoryState } from …/gen/state.gen` 后按名挂根（形态 A 亦可用
 *   `InferStateSchema<typeof state>` 静态推导）。宽 StateRoot 仅为该桥缺省前的回退。
 * - `jump`：真身通道 = `@lingfan-engine/editor` 词汇层词（词表出口 + emitWordCommand 特判
 *   → emitJump）；本声明只为 IDE/类型检查补齐，不改变运行时通道。
 * - `define` / `defineVars`：config.ts 构建期内建（求值环境注入，无运行时实体）；
 *   全局声明供 config.ts 书写与 tsc 通过。
 * - `StoriesConfig`：config.ts default 对象形态的类型（declare global，零 import 全局可用）；
 *   `satisfies StoriesConfig` 给 default 导出强校验与 IDE 键名补全。
 */
import type { StoryCommand } from "@lingfan-engine/core";

export interface StateRoot {
  // 宽索引签名是未接 gen 桥工程的缺省回退：gen/state.gen.d.ts 已提供精确 StoryState，
  // 桥文件引它后本接口即不参与；回退存在是为了「还没写桥」的消费工程能直接写
  // state.player.gold += 20，unknown 做不到这一点。
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

  /** config.ts default 对象的键契约（folders/start 必需；version/vars/state 可缺省）。 */
  interface StoriesConfig {
    /** 嗯，这个是你故事的目录，我让它支持你可以这样一个扫递归，也支持多目录，看你自己需要 */
    readonly folders: readonly string[];
    /** 这个是你需要启动的故事，注意它对应的是你 `export default function 我是故事名称` 的这个我是故事名称，哦，这个名字你自己取 */
    readonly start: string;
    /** 顾名思义版本 */
    readonly version?: number;
    /** 这个是你需要注册的变量键，注意它对应的是你 `defineVars` 的这个 defineVars，你也可以defineVars */
    readonly vars?: Record<string, string>;
    /** 这个是你需要注册的状态，注意它对应的是你 `state` 的这个 state，你也可以define，都可以的 */
    readonly state?: Record<string, unknown>;
  }
}

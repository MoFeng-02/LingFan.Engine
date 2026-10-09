/**
 * 宿主命名命令注册表 —— 通用命令扩展处理器的注册制。
 *
 * 用途：元素的 `cmd` 属性是**宿主业务命令**（打开设置面板、回标题、外部跳转…），
 * 引擎核心不感知这些命令（输入语义归核心层——`nav` 走核心 `navigate`，
 * `cmd` 走宿主注册表；未注册即 fail-closed，不静默吞掉作者意图）。
 *
 * 与 minigame / 元素渲染器注册表同一口径：**无默认回退**。
 */
import type { ElementInstance } from "@lingfan/engine";

/**
 * 命令处理器。
 * `value` 为**点击时**已求值的参数（宿主先用 `engine.interpolate` 插值，
 * 取值语义 = 点击那一刻的变量值）。
 */
export type NamedCommandHandler = (
  value: string | undefined,
  source: ElementInstance,
) => void;

/**
 * 宿主命令表：`register` 与 `get` 是配对的两端，`get` 未命中即 `undefined`
 * （这里不兜底——命令没注册就是没注册，由调用方决定怎么上报）。
 * 表本身不持有状态，命令处理器持有的状态与它无关。
 */
export interface CommandRegistry {
  /** 注册/覆盖（同名再注册 = 替换，宿主扩展与开发热替换语义） */
  register(name: string, handler: NamedCommandHandler): void;
  /** 解析处理器；未注册 = undefined（fail-closed，宿主必须显式上报） */
  get(name: string): NamedCommandHandler | undefined;
  has(name: string): boolean;
  /** 已注册命令名（诊断 / 帮助面板用） */
  names(): string[];
}

/** 造一张空的宿主命令表；命令由宿主在装配期注册，本函数不预置任何命令 */
export function createCommandRegistry(): CommandRegistry {
  const handlers = new Map<string, NamedCommandHandler>();
  return {
    register(name: string, handler: NamedCommandHandler): void {
      handlers.set(name, handler);
    },
    get(name: string): NamedCommandHandler | undefined {
      return handlers.get(name);
    },
    has(name: string): boolean {
      return handlers.has(name);
    },
    names(): string[] {
      return [...handlers.keys()];
    },
  };
}

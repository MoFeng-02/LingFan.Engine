/**
 * 引擎装配契约：宿主组合根构造引擎时注入的端口、扩展与运行期守卫。
 *
 * 这些形状被跨包消费（编辑器扩展出口、UI 覆盖层、宿主组合根、生成的故事代码），
 * 且本身不依赖引擎实现，故与其它契约同住契约层；引擎实现只按契约读取它们。
 */
import type { OpExtension } from "./extension";
import type { SaveDataV1, SaveMode, SavePort } from "./save";
import type { I18nPort } from "./story";

/** 引擎构造选项（全部可选；缺省即内建行为） */
export interface EngineOptions {
  /** 历史容量上限（默认 200），超限淘汰最旧 */
  historyLimit?: number;
  /** 确定性随机：初始 rng 种子（缺省按当前时间） */
  rngSeed?: number;
  /** 存档编排端口（save/load/auto_save/save_delete 等 op 与命令面 save/load 的依赖；缺省 = 存档类 op fail-closed） */
  savePort?: SavePort;
  /** 存档模式（缺省 machine-bound；与 Rust 层同缺省） */
  saveMode?: SaveMode;
  /** 译文供给端口（setLanguage 按需加载译文；缺省 = 原文直出） */
  i18nPort?: I18nPort;
  /** 自定义 op 扩展（构造期注册校验，fail-fast；缺省 = 无扩展，unknown-op 口径不变） */
  extensions?: readonly OpExtension[];
  /**
   * 存档版本迁移钩子：`formatVersion` 非 1 的档先经此迁移。
   * 返回 v1 载荷 = 放行并发 `load.notice`；返回 null = 无法迁移 ⇒ 可操作拒绝。
   * 缺省 = 非 v1 档直接可操作拒绝。
   */
  migrateSave?: (data: unknown) => SaveDataV1 | null;
  /**
   * 运行期守卫注册表（组合根注入，信任域 = 组合根；缺省 = guard op 一律 guard-unknown）。
   *
   * 签名 `(ctx, args)`：ctx = 引擎沙箱上下文（get / fail，**契约只增**——后续能力长在 ctx 上）；
   * args = 故事数据提供的纯数据参数（与 call 的 args 同族）。
   *
   * 失败（ctx.fail 或抛出）⇒ engine.error + 状态原样 + 停在当前命令（fail-closed 拦截）。
   * 守卫**不改状态**：ctx 无 set —— 校验/拦截归守卫，改状态归 set 与自定义 op。
   */
  guards?: Readonly<Record<string, GuardFn>>;
}

/** 守卫的引擎沙箱上下文（首版 = get / fail；**契约只增**：新能力以可选方法扩展） */
export interface GuardContext {
  /** 读 SSOT 状态（含 `__` 系统键；与引擎 get 同口径） */
  get(key: string): unknown;
  /** 拦截：立即中止守卫并以该消息 fail-closed（状态原样 + 停在当前命令） */
  fail(message: string): never;
}

/** 运行期守卫函数：纯逻辑（同状态同 args 同结果 ⇒ 重放同位同判）；不改状态 */
export type GuardFn = (ctx: GuardContext, args: Record<string, unknown>) => void;

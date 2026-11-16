/**
 * 列身体的能力面（宿主注入给组件的唯一通道）。
 *
 * 为什么要有这一层：组件需要读引擎状态、需要把玩家操作交回引擎执行，但它**不得持有
 * 引擎实例**——持有实例会让组件绕过回溯记账、让同一份存档在三个宿主上表现不同，
 * 也让跨端（小程序 / 未来的绘制后端）无法只替换渲染层。
 *
 * 三条边界：
 * - **读面只读**：查询返回的是此刻的值，宿主不保证引用稳定。不要缓存返回值——要响应
 *   变化请订阅 `onChange` / `onEvent`。
 * - **写面一律是「意图」**：`submit` / `navigate` / `write` 都交给引擎执行。组件不得
 *   假设写操作立即生效——引擎可能因约束失败而整份回滚。
 * - **写作用域受限**：组件只能写 `game.<systemId>.<key>`，写不了 SYS 键，也写不了
 *   作者的全局变量。理由与 `interaction` / `minigame` 的隔离方式一致：外部系统的
 *   写入必须落在自己的命名空间里，否则「这个值是谁改的」无法追。
 */
import type { StoryCommand } from "./story/index.ts";
import type { ColumnSummary } from "./runtime/column-summary.ts";
import type { OutboundEvent } from "./runtime/events.ts";
import type { StageLayout, StageViewport } from "./shell.ts";

/**
 * 状态只读视图：只给读，不给写。
 *
 * 写必须走 `SceneEnv.write` / `SceneEnv.writeSilent`——那两个方法强制落
 * `game.<systemId>.<key>`，让「谁写了这个值」永远可追。
 */
export interface ReadonlyGameState {
  /** 读全局键（`game.x.y` / 作者变量 / 任意状态键） */
  get(key: string): unknown;
  /** 读本系统命名空间下的一个键 */
  getScoped(systemId: string, key: string): unknown;
}

/**
 * 列身体的能力面。
 *
 * 由宿主在挂载身体组件时作为 prop 注入（约定属性名 `env`），组件不要自己去找引擎。
 */
export interface SceneEnv {
  // ── 读面 ──────────────────────────────────────────────

  /** 读引擎状态（同 `engine.get`；读不到返回 `undefined`） */
  get(key: string): unknown;

  /** 状态的只读视图（读 `game.<id>.<key>` 用 `getScoped`） */
  readonly state: ReadonlyGameState;

  /** 全部列的摘要（每次调用都是新数组，不要缓存） */
  columns(): readonly ColumnSummary[];

  /** 当前列 id */
  currentColumn(): string;

  /** 历史长度（可用于显示「还能退几步」） */
  historyLength(): number;

  /** 历史游标（当前检查点下标） */
  historyCursor(): number;

  /**
   * 求值一个表达式（`{game.x.y}` 形态）；求值失败返回原始字符串。
   *
   * 用途：组件想在模板里显示一个随状态变化的值，但 `props` 是静态的。
   */
  interpolate(source: string): unknown;

  /** 订阅引擎状态变化；返回取消订阅函数 */
  onChange(listener: () => void): () => void;

  /** 订阅引擎出站事件；返回取消订阅函数 */
  onEvent(listener: (event: OutboundEvent) => void): () => void;

  // ── 写面（意图）──────────────────────────────────────

  /**
   * 提交一批命令给引擎执行（`say` / `set` / `if` / `while` / `call` …）。
   *
   * 语义与 `engine.submitSceneOps` 一致：不建检查点、整次拒绝存档类命令、
   * 失败整份回滚、返回是否全部执行成功。
   *
   * 停在等待态（`say` / `menu` / `wait` / 接管族）不算失败：画面仍是当前列身体，
   * 等待层叠在它上面，玩家推进后继续跑剩下的命令。
   */
  submit(ops: readonly StoryCommand[]): boolean;

  /**
   * 调用一个 label / 函数（`submit([{ op: "call", target }])` 的简写）。
   *
   * 与 `navigate` 的区别是**换不换画面**：`call` 不换列，跑完自动回来，
   * 这一屏的身体组件一直挂着；`navigate` 换列（换身体）。
   * 要「点一下说几句话，画面不动」，用这个。
   *
   * @param target 列 id，或故事源里导出的具名块（走具名块时不可逐句回退）
   */
  call(target: string): boolean;

  /** 跳转到另一条列（换列即换身体） */
  navigate(columnId: string): void;

  /** 写 `game.<systemId>.<key>` 并进事件流（低频：需要界面响应） */
  write(systemId: string, key: string, value: unknown): boolean;

  /** 写 `game.<systemId>.<key>` 不进事件流（高频：每帧坐标这类） */
  writeSilent(systemId: string, key: string, value: unknown): boolean;

  // ── 舞台适配 ──────────────────────────────────────────

  /**
   * 舞台视口与变换（宿主在挂载后与每次尺寸变化后刷新）。
   *
   * 组件**不要自己监听 `resize`**：那既是 DOM（违反 `packages/ui/src/**` 的分层红线），
   * 小程序端也根本没有这个事件。要跟着窗口变，读这里的值即可——宿主刷完会触发
   * `onChange`，组件订阅后在回调里重新读取。
   *
   * 返回的 `layout` 是**算好的数值**：组件不自乘缩放系数、不自加偏移，按设计基准
   * 坐标书写即可。
   */
  stage(): { readonly viewport: StageViewport; readonly layout: StageLayout };
}

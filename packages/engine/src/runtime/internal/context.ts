/**
 * 命令处理器需要看到的执行器内部面。
 *
 * 命令处理器（每个 op 的执行逻辑）本身是自由函数，拿不到类的私有成员；
 * 它们统一收一个 `OpContext`，里面只列处理器真正用到的东西——
 * 帧栈与坐标、状态读写、检查点与回溯、翻译、随机数、存档编排。
 *
 * **唯一转换点**：执行器实例持有
 * `private readonly ctx = this as unknown as OpContext;`，
 * 全仓仅此一处把 `this` 转成该接口；处理器一律经它取状态。
 *
 * **为什么必须逐名核对**：转换用了双重断言，接口字段与执行器实际成员的差异
 * 编译器一概不报——多声明的成员会让处理器拿到 `undefined` 并在调用点崩溃，
 * 少声明则直接失去类型保护。增删本接口成员时必须同时在执行器侧核对。
 *
 * 本接口只在运行层内部流转，不进包出口。
 */
import type {
  I18nPort,
  AnimationSpec,
  CharacterDef,
  ColumnCoordinate,
  ElementInstance,
  EventListener,
  GuardFn,
  OpExtension,
  OutboundPayload,
  SaveDataV1,
  SaveMode,
  SavePort,
  StateListener,
  Story,
  StoryColumn,
  StoryCommand,
} from "../../contracts";
import type { ExprValue } from "../expr";
import type { RegisteredOp } from "../opRegistry";
import type { Checkpoint, Frame, LoopState } from "./frame";

/**
 * 命令处理器与执行器私有面之间的通道：处理器只读这里列出的成员，
 * 增删成员必须同时在执行器侧核对（见上方「唯一转换点」与「逐名核对」说明）。
 */
export interface OpContext {
  // —— 故事与状态容器 ——

  /** 当前故事（热重载时整体替换） */
  story: Story;
  /** 状态容器：系统键 + 全局用户键；值写时复制，快照浅拷贝即安全 */
  state: Map<string, unknown>;
  /** 读一个状态键（未命中 = undefined） */
  get(key: string): unknown;
  /** 写全局用户键（进存档） */
  setGlobal(key: string, value: unknown): void;
  /** 写系统键（不进用户存档） */
  setSystem(key: string, value: unknown): void;

  // —— 帧栈与坐标 ——

  frames: Frame[];
  coord: ColumnCoordinate;
  /** 循环 break/continue 的帧栈定位（返回最近的循环帧下标；无循环返回 -1） */
  nearestLoopIndex(): number;
  /** 推进 iterate 型循环到下一轮（含作用域重建） */
  beginLoopIteration(frame: Frame, loop: LoopState): boolean;
  /** 压入 iterate 型循环帧（for / foreach 共用） */
  pushIterateLoop(
    frame: Frame,
    cmd: StoryCommand,
    items: ExprValue[],
  ): boolean;
  /** 按列 id 取列定义 */
  columnById(id: string): StoryColumn | undefined;
  /** 当前列帧（自栈顶向下第一个列帧） */
  columnFrame(): Frame | undefined;
  /** 按坐标造一个「未执行」的列帧（读档重建用） */
  columnFrameAt(coord: ColumnCoordinate): Frame;
  /** 进入一条列：重置帧栈、装载元素、记账菜单返回点 */
  enterColumn(columnId: string): boolean;

  // —— 解释执行 ——

  /** 逐命令解释执行到等待点或结束 */
  run(): void;

  // —— 表达式与随机数 ——

  /** 条件求值：null = 求值失败（调用方停机） */
  evalCond(src: unknown): boolean | null;
  /** 值求值：数字/布尔原样，字符串走表达式或字面量 */
  evalValue(raw: unknown): ExprValue;
  /** 读变量：未定义即抛 ExpressionError */
  readVariable(key: string): ExprValue;
  /** 名称解析（作用域链 → 全局键 → 点路径下钻） */
  resolveName: (name: string) => { found: true; value: unknown } | { found: false };
  /** 确定性随机 [0,1) */
  draw(): number;
  /** 随机数状态（进快照，重放序列必然一致） */
  rngState: number;

  // —— 检查点与历史 ——

  history: Checkpoint[];
  /** 光标：时间线上最后归档的检查点位置（回溯后落后于末尾） */
  cursor: number;
  readonly historyLimit: number;
  /** 当前 live 画面是否已入档（menu/wait/input 展示中为真；say 刚上屏为假） */
  liveCheckpointed: boolean;
  /** 重放期标记 */
  rollbackActive: boolean;
  /** say 上屏时捕获的待提交检查点 */
  pendingSay: Checkpoint | null;
  /** 捕获当前快照（帧栈深拷贝 + 状态浅拷贝） */
  takeSnapshot(coord: ColumnCoordinate): Checkpoint;
  /** 当前等待点应归档的坐标（块帧回退到所属列帧的位置） */
  checkpointCoord(waitingFrame: Frame): ColumnCoordinate;
  /** 提交检查点：同坐标原位替换，否则追加并按上限裁剪 */
  commitCheckpoint(cp: Checkpoint): void;
  /** 把待提交的 say 检查点入档（离开当前画面时调用） */
  flushPendingCheckpoint(): void;
  /** 等待画面建立时的自动存档消费点 */
  autoSaveAtCheckpoint(): void;
  /** 当前列是否可重放（决定回溯能否落回该处） */
  isCurrentColumnReplayable(): boolean;
  /** 最近一个可重放检查点的下标（没有则 null） */
  lastReplayableCursor(): number | null;

  // —— 存档编排 ——

  savePort: SavePort | undefined;
  saveMode: SaveMode;
  readonly usedExtensions: Set<string>;
  readonly extensionById: ReadonlyMap<string, OpExtension>;
  readonly migrateSaveHook: ((data: unknown) => SaveDataV1 | null) | undefined;
  /** 存档写盘（经 SavePort） */
  exportSave(): SaveDataV1 | null;
  /** 读档：校验 → 迁移 → 恢复 → 重放 */
  importSave(data: SaveDataV1): boolean;
  /** 按槽位读档（命令面用） */
  load(slot: string): boolean;
  /** 旧版本存档迁移 */
  tryMigrateSave(data: SaveDataV1): SaveDataV1 | null;
  /** 校验存档声明的扩展依赖是否齐备 */
  resolveSaveExtensions(data: SaveDataV1): [string, unknown][] | null;
  /** 让已装配的扩展恢复其存档状态 */
  restoreSaveExtensions(marks: SaveDataV1["extensions"]): boolean;

  // —— 等待与中断 ——

  started: boolean;
  waitSkipable: boolean;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  inputStore: string | null;
  /** 清掉等待定时器 */
  clearTimer(): void;
  /** 中断所有外部接管（小游戏 / 玩法系统），UI 据此卸载 */
  abortExternalTakeovers(): void;
  abortInteraction(): void;
  abortMinigame(): void;
  interactionSeq: number;
  interactionController: AbortController | null;
  pendingInteraction: {
    system: string;
    onSuccess?: string;
    onFail?: string;
  } | null;
  minigameSeq: number;
  minigameController: AbortController | null;
  pendingMinigame: {
    onSuccess?: string;
    onFail?: string;
    reward: { key: string; value: unknown }[];
  } | null;

  // —— 媒体与动画序号 ——

  mediaSeq: number;
  videoSeq: number;
  animationSeq: number;
  transitionSeq: number;
  shakeSeq: number;
  /** 当前挂起的动画列表（读改写的原子入口） */
  animations(): AnimationSpec[];

  // —— 元素 ——

  /** 当前画面元素（读 `SYS.elements`） */
  elements(): ElementInstance[];
  /** 按目标选择器找元素 */
  findElements(target: string): ElementInstance[];
  /** 递归映射元素树 */
  mapElements(mapper: (el: ElementInstance) => ElementInstance): ElementInstance[];

  // —— i18n ——

  /** 译文 overlay 加载端口（组合根注入）；未装配时语言切换只清空 overlay */
  i18nPort: I18nPort | undefined;
  /** 当前语言译文表（null = 原文直出） */
  overlay: Map<string, string> | null;
  /** 取译文（未命中回退原文） */
  translate(original: string): string;
  /** 递归翻译元素展示文字 */
  translateElements(instances: readonly ElementInstance[]): ElementInstance[];

  // —— 事件与守卫 ——

  readonly stateListeners: Set<StateListener>;
  readonly eventListeners: Set<EventListener>;
  /** 状态变更广播 */
  emit(key: string, value: unknown, scope: string): void;
  /** 出站事件广播 */
  emitEvent(payload: OutboundPayload): void;
  /** engine.error 出站，绝不静默 */
  fail(code: string, message: string): void;
  /** 运行期守卫注册表（组合根注入） */
  readonly guards: Readonly<Record<string, GuardFn>>;

  // —— 其它 ——

  /** 角色定义注册表 */
  readonly characters: Map<string, CharacterDef>;
  /** 函数注册表（func 执行期注册，call 按名查表；随快照恢复） */
  functions: Map<string, { params: string[]; body: StoryCommand[] }>;
  /** 校验命令里的实例 z 值合法（非法即 fail 并返回 false） */
  rejectBadInstanceZ(cmd: StoryCommand): boolean;
  /** 写实例 z（`SYS.instance_z` 的子键） */
  setInstanceZ(key: string, raw: unknown): void;
  /** 扩展 op 注册表（构造期校验装配） */
  readonly extensionOps: Map<string, RegisteredOp>;
  /** 一次性存档声明（载荷在下一玩家所见等待画面落档） */
  pendingSave: { slot: string; title?: string } | null;
}

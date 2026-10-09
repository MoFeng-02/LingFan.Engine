/**
 * 执行模型：SSOT 状态容器 + 帧栈式逐命令解释执行 + advance/choose 命令面。
 * 作用域：块/列级 Scope 树 + 全局（SSOT Map）；块/列级不进存档。
 * 框架无关：只写状态与事件，渲染归 UI 层。
 */
import type { AnimationSpec, CharacterDef, ColumnCoordinate, ElementInstance, EngineOptions, EventListener, GuardFn, I18nPort, MinigameResult, OpExtension, OutboundPayload, SaveDataV1, SaveMode, SavePort, StateListener, Story, StoryColumn, StoryCommand, SaveOptions } from "../contracts";
import { gameScopedKey, type GameStateWriter, type InteractionResult } from "../contracts";
import { buildOpRegistry } from "./opRegistry";
import type { RegisteredOp } from "./opRegistry";
import { runDispatch } from "./dispatch";
import { abortInteraction, abortMinigame, resolveInteraction, resolveMinigame, runElementOps } from "./ops";
import { emitChange, emitErrorEvent, evalValue, publishEvent, readVariable, rejectBadInstanceZ, resolveName, setGlobal, setInstanceZ, setSilentKey, setSystem, writeExternal } from "./state";
import { autoSaveAtCheckpoint, back, checkpointCoord, columnFrame, columnFrameAt, commitCheckpoint, flushPendingCheckpoint, forward, historyCursor, historyLength, historyView, isCurrentColumnReplayable, lastReplayableCursor, restore, rollbackTo, takeSnapshot } from "./history";
import { exportSave, importSave, resolveSaveExtensions, restoreSaveExtensions, tryMigrateSave } from "./save";
import { type ExprValue } from "./expr";
import { translate, translateElements } from "./i18n";
import { abortExternalTakeovers, advance, animationFinished, animations, beginLoopIteration, choose, clearTimer, columnById, dispose, draw, elements, enterColumn, evalCond, findElements, getCharacter, getCharacters, input, interpolate, load, mapElements, navigate, nearestLoopIndex, onEvent, onStateChanged, pushIterateLoop, reloadStory, reportMediaPosition, save, setLanguage, shakeFinished, start, transitionFinished, videoFinished, type Checkpoint, type Frame, type LoopState, type OpContext } from "./internal";
import type { NameResolver } from "./resolver";

/**
 * 装配契约（构造选项与守卫）定义在契约层，此处按原路径转出，
 * 既有消费方无需改动即可继续从本模块取；收口时统一改走包出口。
 */
export type { EngineOptions, GuardContext, GuardFn } from "../contracts";

export class StoryEngine {
  private story: Story; // 热重载原子替换：private 字段非公共契约
  /** SSOT：系统键 + 全局用户键（块/列级变量在 Scope 树，不进此 Map）；值写时复制 → 快照浅拷贝安全 */
  private state = new Map<string, unknown>();
  private coord: ColumnCoordinate = { columnId: "", index: 0 };
  private frames: Frame[] = [];
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private started = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private waitSkipable = false;
  /** 角色定义注册表（character op 注册，say speaker 匹配自动套样式） */
  private readonly characters = new Map<string, CharacterDef>();
  /** 函数注册表（func 执行期注册，call 按名查表；随快照恢复） */
  private functions = new Map<
    string,
    { params: string[]; body: StoryCommand[] }
  >();
  private inputStore: string | null = null;
  // —— 回溯与历史 ——
  private readonly historyLimit: number;
  private history: Checkpoint[] = [];
  /** 光标 = 当前时间线上最后归档的检查点（回溯后落后于 length-1；rollforward 用） */
  private cursor = -1;
  /** live 消歧：当前 live 画面是否已入档（menu/wait/input 展示中=true；say 上屏=false） */
  private liveCheckpointed = false;
  /** 重放期标记（__rollback_active 键镜像） */
  private rollbackActive = false;
  /** say 上屏时捕获的待提交检查点（等待解除后才入档） */
  private pendingSay: Checkpoint | null = null;
  /** 确定性随机状态（mulberry32），进快照 */
  private rngState: number;
  /** se 触发序号：单调递增且不进快照——重放/读档后仍能区分「再次触发」 */
  private mediaSeq = 0;
  /** 视频命令序号：单调递增且不进快照（渲染器按 seq 执行/去重） */
  private videoSeq = 0;
  /** 元素动画序号：单调递增且不进快照（连续动画与重放后的同命令可分辨） */
  private animationSeq = 0;
  /** 转场 / 震动启动序号：同上（UI 据此判定「新的一次」） */
  private transitionSeq = 0;
  private shakeSeq = 0;
  /** 小游戏挂载序号：单调递增且不进快照（重放重新挂载与旧挂载可分辨） */
  private minigameSeq = 0;
  /** 挂起的小游戏等待：分流目标与已求值奖励（resolveMinigame 消费；中断即清除） */
  private pendingMinigame: {
    onSuccess?: string;
    onFail?: string;
    reward: { key: string; value: unknown }[];
  } | null = null;
  /** 当前挂载的中断信号源：回溯/读档/导航/销毁时 abort（UI 据此卸载） */
  private minigameController: AbortController | null = null;
  /** 外部玩法系统挂载序号（与 minigameSeq 同构：单调、不进快照） */
  private interactionSeq = 0;
  /** 挂起的玩法系统接管：系统标识 + 分流目标（resolveInteraction 消费；中断即清除） */
  private pendingInteraction: {
    system: string;
    onSuccess?: string;
    onFail?: string;
  } | null = null;
  /** 当前玩法系统挂载的中断信号源（回溯/读档/导航/销毁时 abort） */
  private interactionController: AbortController | null = null;

  /** 存档编排端口与模式（组合根注入；缺省 = 存档类 op/命令面 fail-closed） */
  private savePort: SavePort | undefined;
  private saveMode: SaveMode;
  /** save op 的一次性存档声明：载荷在下一玩家所见等待画面落档（coord = 等待点） */
  private pendingSave: { slot: string; title?: string } | null = null;
  /** I18N 端口与当前语言译文表（null = 原文直出；切换 = 整表重建并清缓存） */
  private i18nPort: I18nPort | undefined;
  private overlay: Map<string, string> | null = null;
  /** 扩展 op 注册表（构造期校验装配；查找序 = 内建 → 扩展 → unknown-op） */
  private readonly extensionOps: Map<string, RegisteredOp>;
  /** 扩展声明索引（id → 声明：存档依赖校验 / migrate / restore 用） */
  private readonly extensionById: ReadonlyMap<string, OpExtension>;
  /** 本档实际执行过的扩展（op 执行时登记；exportSave 落盘依赖标记；读档继承档内标记） */
  private readonly usedExtensions = new Set<string>();
  /** 存档版本迁移钩子（宿主注入；缺省 = 非 v1 档可操作拒绝） */
  private readonly migrateSaveHook?: (data: unknown) => SaveDataV1 | null;
  /** 运行期守卫注册表（组合根注入；缺省 = guard op 一律 guard-unknown fail-closed） */
  private readonly guards: Readonly<Record<string, GuardFn>>;

  /**
   * 命令处理器与执行器私有面之间的唯一通道。
   *
   * 处理器迁出为自由函数后统一收这个对象；全仓仅此一处把 `this` 转成它。
   * 转换必须写成双重断言（私有成员无法直接满足接口），编译器不会核对
   * 接口声明与执行器实际成员是否一一对应——增删本接口成员时要两边同时看。
   */
  private readonly ctx: OpContext;

  /**
   * 建立命令处理器与执行器私有面之间的通道。
   *
   * 处理器迁出为自由函数后，有一部分成员只被处理器经此通道读写，编译期的
   * 「声明未使用」检查看不到这层访问，因此在这里显式登记一遍：登记既让检查放行，
   * 也让成员改名时在这里立刻报错。
   */
  private buildOpContext(): OpContext {
    void [
      // 守卫表、扩展注册表与循环帧压栈
      this.guards,
      this.extensionOps,
      this.pushIterateLoop,
      this.nearestLoopIndex,
      // 表达式求值与状态写入
      this.readVariable,
      this.evalValue,
      this.evalCond,
      this.setSilentKey,
      this.emit,
      // 媒体、动画与等待序号
      this.mediaSeq,
      this.animationSeq,
      this.transitionSeq,
      this.shakeSeq,
      this.minigameSeq,
      this.interactionSeq,
      // 实例 z 校验与落账
      this.rejectBadInstanceZ,
      this.setInstanceZ,
      // 检查点与历史回溯
      this.checkpointCoord,
      this.takeSnapshot,
      this.restore,
      this.autoSaveAtCheckpoint,
      this.historyLimit,
      this.history,
      this.cursor,
      this.liveCheckpointed,
      this.lastReplayableCursor,
      this.isCurrentColumnReplayable,
      this.columnFrame,
      this.columnFrameAt,
      // 存档编排
      this.pendingSave,
      this.overlay,
      this.extensionById,
      this.migrateSaveHook,
      this.tryMigrateSave,
      this.resolveSaveExtensions,
      this.restoreSaveExtensions,
      // 外部玩法系统的状态写入面
      this.gameState,
      this.pendingMinigame,
      this.minigameController,
      this.pendingInteraction,
      this.interactionController,
      this.functions,
      this.usedExtensions,
      // 文本国际化
      this.translate,
      // 会话、帧栈、等待、媒体与舞台机制（只经 ctx 被迁出的自由函数读写）
      this.story,
      this.coord,
      this.frames,
      this.stateListeners,
      this.eventListeners,
      this.started,
      this.pendingTimer,
      this.waitSkipable,
      this.characters,
      this.inputStore,
      this.rollbackActive,
      this.pendingSay,
      this.rngState,
      this.videoSeq,
      this.savePort,
      this.saveMode,
      this.i18nPort,
      this.clearTimer,
      this.abortExternalTakeovers,
      this.abortInteraction,
      this.abortMinigame,
      this.setGlobal,
      this.setSystem,
      this.emitEvent,
      this.fail,
      this.translateElements,
      this.columnById,
      this.enterColumn,
      this.run,
      this.beginLoopIteration,
      this.mapElements,
      this.commitCheckpoint,
      this.flushPendingCheckpoint,
      this.draw,
      this.resolveName,
    ];
    return this as unknown as OpContext;
  }

  constructor(story: Story, options?: EngineOptions) {
    this.story = story;
    this.historyLimit = options?.historyLimit ?? 200;
    this.rngState = (options?.rngSeed ?? Date.now()) | 0;
    this.savePort = options?.savePort;
    this.saveMode = options?.saveMode ?? "machine-bound";
    this.i18nPort = options?.i18nPort;
    const extensions = options?.extensions ?? [];
    this.extensionOps = buildOpRegistry(extensions);
    this.extensionById = new Map(extensions.map((e) => [e.id, e]));
    this.migrateSaveHook = options?.migrateSave;
    this.guards = options?.guards ?? {};
    this.ctx = this.buildOpContext();
  }

  // —— 观察接缝 ——

  /** ValueChanged 是唯一观察接缝；所有状态写入都经 set 系方法镜像到这里 */
  onStateChanged(listener: StateListener): () => void { return onStateChanged(this.ctx, listener); }
  onEvent(listener: EventListener): () => void { return onEvent(this.ctx, listener); }
  get(key: string): unknown {
    return this.state.get(key);
  }

  // —— 会话命令面（最小子集：start / advance / choose） ——

  /** story.start：导航至入口列（entry 取自 project.json） */
  start(): void { start(this.ctx); }
  advance(): void { advance(this.ctx); }
  choose(optionId: string): void { choose(this.ctx, optionId); }
  navigate(columnId: string): void { navigate(this.ctx, columnId); }
  save(slot: string, options?: SaveOptions): boolean { return save(this.ctx, slot, options); }
  load(slot: string): boolean { return load(this.ctx, slot); }
  async setLanguage(lang: string): Promise<void> { return setLanguage(this.ctx, lang); }
  dispose(): void { dispose(this.ctx); }
  elements(): ElementInstance[] { return elements(this.ctx); }
  findElements(target: string): ElementInstance[] { return findElements(this.ctx, target); }
  interpolate(source: string): string { return interpolate(this.ctx, source); }
  runElementOps(ops: readonly Record<string, unknown>[]): boolean { return runElementOps(this.ctx, ops); }
  resolveMinigame(result: MinigameResult): boolean { return resolveMinigame(this.ctx, result); }
  private clearTimer(): void { clearTimer(this.ctx); }
  resolveInteraction(system: string, result: InteractionResult): boolean { return resolveInteraction(this.ctx, system, result); }
  private abortExternalTakeovers(): void { abortExternalTakeovers(this.ctx); }
  private abortInteraction(): void { abortInteraction(this.ctx); }
  private abortMinigame(): void { abortMinigame(this.ctx); }
  private setGlobal(key: string, value: unknown): void { setGlobal(this.ctx, key, value); }
  private setSystem(key: string, value: unknown): void { setSystem(this.ctx, key, value); }
  private setSilentKey(key: string, value: unknown): boolean { return setSilentKey(this.ctx, key, value); }
  readonly gameState: GameStateWriter = {
    set: (key: string, value: unknown): boolean => this.writeExternal(key, value, true),
    setSilent: (key: string, value: unknown): boolean =>
      this.writeExternal(key, value, false),
    setScoped: (systemId: string, key: string, value: unknown): boolean =>
      this.writeExternal(gameScopedKey(systemId, key), value, true, systemId),
    setScopedSilent: (systemId: string, key: string, value: unknown): boolean =>
      this.writeExternal(gameScopedKey(systemId, key), value, false, systemId),
    get: (key: string): unknown => this.state.get(key),
  };

  /**
   * 外部写入的公共实现：键校验（保留键 + 命名空间合法性）→ 值契约 → 落 SSOT。
   * `emitChange = false` 走静默通道（帧级高频写）。
   */
  private writeExternal(key: string, value: unknown, emitChange: boolean, systemId?: string): boolean { return writeExternal(this.ctx, key, value, emitChange, systemId); }
  private rejectBadInstanceZ(cmd: StoryCommand): boolean { return rejectBadInstanceZ(this.ctx, cmd); }
  private setInstanceZ(key: string, raw: unknown): void { setInstanceZ(this.ctx, key, raw); }
  private emit(key: string, value: unknown, scope: string): void { emitChange(this.ctx, key, value, scope); }
  private emitEvent(payload: OutboundPayload): void { publishEvent(this.ctx, payload); }
  private fail(code: string, message: string): void { emitErrorEvent(this.ctx, code, message); }
  private translate(original: string): string { return translate(this.ctx, original); }
  private translateElements(instances: readonly ElementInstance[]): ElementInstance[] { return translateElements(this.ctx, instances); }
  private columnById(id: string): StoryColumn | undefined { return columnById(this.ctx, id); }
  private lastReplayableCursor(): number | null { return lastReplayableCursor(this.ctx); }
  private isCurrentColumnReplayable(): boolean { return isCurrentColumnReplayable(this.ctx); }
  private enterColumn(columnId: string): boolean { return enterColumn(this.ctx, columnId); }
  private run(): void { runDispatch(this.ctx); }
  private checkpointCoord(waitingFrame: Frame): ColumnCoordinate { return checkpointCoord(this.ctx, waitingFrame); }
  private pushIterateLoop(frame: Frame, cmd: StoryCommand, items: ExprValue[]): boolean { return pushIterateLoop(this.ctx, frame, cmd, items); }
  private beginLoopIteration(frame: Frame, loop: LoopState): boolean { return beginLoopIteration(this.ctx, frame, loop); }
  private nearestLoopIndex(): number { return nearestLoopIndex(this.ctx); }
  private evalCond(src: unknown): boolean | null { return evalCond(this.ctx, src); }
  getCharacter(key: string): CharacterDef | undefined { return getCharacter(this.ctx, key); }
  getCharacters(): CharacterDef[] { return getCharacters(this.ctx); }
  private mapElements(mapper: (el: ElementInstance) => ElementInstance): ElementInstance[] { return mapElements(this.ctx, mapper); }
  animations(): AnimationSpec[] { return animations(this.ctx); }
  animationFinished(seq: number): void { animationFinished(this.ctx, seq); }
  transitionFinished(): void { transitionFinished(this.ctx); }
  shakeFinished(): void { shakeFinished(this.ctx); }
  videoFinished(): void { videoFinished(this.ctx); }
  reportMediaPosition(seconds: number): void { reportMediaPosition(this.ctx, seconds); }
  input(value: string): void { input(this.ctx, value); }
  private columnFrame(): Frame | undefined { return columnFrame(this.ctx); }
  private columnFrameAt(coord: ColumnCoordinate): Frame { return columnFrameAt(this.ctx, coord); }
  exportSave(): SaveDataV1 | null { return exportSave(this.ctx); }
  importSave(data: SaveDataV1): boolean { return importSave(this.ctx, data); }
  private tryMigrateSave(data: SaveDataV1): SaveDataV1 | null { return tryMigrateSave(this.ctx, data); }
  private resolveSaveExtensions(data: SaveDataV1): [string, unknown][] | null { return resolveSaveExtensions(this.ctx, data); }
  private restoreSaveExtensions(marks: SaveDataV1["extensions"]): boolean { return restoreSaveExtensions(this.ctx, marks); }
  private takeSnapshot(coord: ColumnCoordinate): Checkpoint { return takeSnapshot(this.ctx, coord); }
  private restore(cp: Checkpoint): void { restore(this.ctx, cp); }
  private commitCheckpoint(cp: Checkpoint): void { commitCheckpoint(this.ctx, cp); }
  private autoSaveAtCheckpoint(): void { autoSaveAtCheckpoint(this.ctx); }
  private flushPendingCheckpoint(): void { flushPendingCheckpoint(this.ctx); }
  rollbackTo(target: number | ColumnCoordinate): void { rollbackTo(this.ctx, target); }
  historyLength(): number { return historyLength(this.ctx); }
  historyCursor(): number { return historyCursor(this.ctx); }
  back(): void { back(this.ctx); }
  forward(): void { forward(this.ctx); }
  reloadStory(story: Story): void { reloadStory(this.ctx, story); }
  historyView(): Array<{ index: number; coord: ColumnCoordinate; speaker: string; text: string; nvl: boolean; nvlLines: string[]; }> { return historyView(this.ctx); }
  private draw(): number { return draw(this.ctx); }
  private evalValue(raw: unknown): ExprValue { return evalValue(this.ctx, raw); }
  private readVariable(key: string): ExprValue { return readVariable(this.ctx, key); }
  private resolveName: NameResolver = (
    name: string,
  ): { found: true; value: unknown } | { found: false } => resolveName(this.ctx, name);
}

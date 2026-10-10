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

/**
 * 叙事引擎的公开门面与状态容器。
 *
 * 职责边界：本类只保留「状态字段 + 一次性装配 + 对外薄转发」；命令解释、状态写入、
 * 历史回溯、存档编排、国际化各自实现在 `./internal`、`./state`、`./history`、`./save`、
 * `./ops`、`./i18n`，命令分发主循环在 `./dispatch`。这些自由函数统一拿 `OpContext`（即本类经
 * {@link StoryEngine.buildOpContext} 断言出来的私有面视图）读写下面的字段。
 * 因此：**改行为去目标模块改，改字段含义看本类**。
 *
 * 推进模型：`start()` 进入口列，`advance()` / `choose()` 推进到下一个玩家可见状态；
 * 等待型命令挂起后由宿主回调解除（`animationFinished()` / `input()` /
 * `resolveMinigame()` 等）。本类不持有 DOM，全部产出经 `onStateChanged()` 与
 * `onEvent()` 两条观察接缝送出；销毁走 `dispose()`。
 */
export class StoryEngine {
  /** 故事定义；`reloadStory()` 会原子替换它，所以推进时每次现取字段，不要缓存引用 */
  private story: Story;
  /** SSOT：系统键 + 全局用户键（块/列级变量在 Scope 树，不进此 Map）；值写时复制 → 快照浅拷贝安全 */
  private state = new Map<string, unknown>();
  /** 当前执行坐标（列 id + 列内命令下标）；帧栈与历史检查点都以它为坐标 */
  private coord: ColumnCoordinate = { columnId: "", index: 0 };
  /** 帧栈：每层是一个正在展开的块/列执行上下文，栈顶即当前推进位置 */
  private frames: Frame[] = [];
  /** 状态变化订阅者（ValueChanged）；写入时同步回调，单个订阅者抛错会向外冒 */
  private readonly stateListeners = new Set<StateListener>();
  /** 对外事件订阅者（进度与错误同走本集合）；与状态订阅同模块但各自独立广播 */
  private readonly eventListeners = new Set<EventListener>();
  /** 是否已 `start()`；未开始时推进类命令一律无效果（防重复入场） */
  private started = false;
  /** 等待型命令的定时器句柄；换列、回溯、读档、热重载、销毁时必须清掉，否则会推进已失效的等待 */
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** 当前等待能否被 `advance()` 解除（wait 的 skipable 且非 hard/pause）；只在引擎内部作为推进判据 */
  private waitSkipable = false;
  /** 角色定义注册表（character op 注册，say speaker 匹配自动套样式） */
  private readonly characters = new Map<string, CharacterDef>();
  /** 函数注册表（func 执行期注册，call 按名查表；随快照恢复） */
  private functions = new Map<
    string,
    { params: string[]; body: StoryCommand[] }
  >();
  /** input 命令挂起时的写入目标键名（值由提交方写到该键）；解除等待时清空，null = 当前没有挂起的 input */
  private inputStore: string | null = null;
  // —— 回溯与历史 ——
  /** 历史检查点上限（构造期定死）；超出后从最旧端丢弃，所以可回溯深度有限 */
  private readonly historyLimit: number;
  /** 已归档的检查点序列，下标 0 最旧；与 `cursor` 配合表达「看到第几个」 */
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
  /** 转场启动序号：单调递增且不进快照（UI 据此判定「新的一次」） */
  private transitionSeq = 0;
  /** 震动启动序号：与 transitionSeq 同构（每次 shake 命令递增，宿主据此判定「新的一次」） */
  private shakeSeq = 0;
  /** 小游戏挂载序号：单调递增且不进快照（重放重新挂载与旧挂载可分辨） */
  private minigameSeq = 0;
  /** 挂起的小游戏等待：注册 game 标识、分流目标与已求值奖励（resolveMinigame 消费；中断即清除） */
  private pendingMinigame: {
    game: string;
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
  /** 存档模式：决定存档可否跨设备读取，也决定 DEK 封装方式（本机绑定 = 用 OS 凭据封存；可携带 = 明文随档）；构造期注入，运行期不变 */
  private saveMode: SaveMode;
  /** save op 的一次性存档声明：载荷在下一玩家所见等待画面落档（coord = 等待点） */
  private pendingSave: { slot: string; title?: string } | null = null;
  /** I18N 端口与当前语言译文表（null = 原文直出；切换 = 整表重建并清缓存） */
  private i18nPort: I18nPort | undefined;
  /** 当前语言译文表（原文 → 译文）；由 `setLanguage()` 整表重建 */
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

  /**
   * 装配引擎：登记故事定义、各端口与扩展，并建好 `ctx` 私有面通道。
   *
   * 选项全部可省：缺省时历史上限 200、随机种子取当前时间、存档模式 `machine-bound`，
   * 且没有存档 / 国际化 / 守卫 / 扩展。缺端口不影响推进，只让对应命令面 fail-closed
   * （例如没有存档端口时 `save()` 固定返回 false）。
   */
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
  /** 订阅对外事件（进度事件与错误事件同路）。返回退订函数 */
  onEvent(listener: EventListener): () => void { return onEvent(this.ctx, listener); }
  /** 读 SSOT 里的当前值；从未写过的键返回 undefined。只读，不触发观察事件 */
  get(key: string): unknown {
    return this.state.get(key);
  }

  // —— 命令面 ——
  // 公开方法都是转交给实现模块的薄壳，语义与错误处理以目标模块为准；夹在其中的
  // private 成员是同一转发模式的内部版本，供迁出的自由函数经 ctx 回调本类私有面。

  /** story.start：导航至入口列（entry 取自 project.json） */
  start(): void { start(this.ctx); }
  /** 推进到下一个玩家可见状态（宿主「继续」入口）：仅对话等待、可跳过的 wait、可跳过的视频播放有效，其余 fail-closed 发 advance-invalid */
  advance(): void { advance(this.ctx); }
  /** 提交选项答案；选项挂起期间有效，optionId 取自 choices 事件载荷 */
  choose(optionId: string): void { choose(this.ctx, optionId); }
  /** 直接跳转到指定列，不经过流程控制命令 */
  navigate(columnId: string): void { navigate(this.ctx, columnId); }
  /** 写档到槽位；返回是否成功。未装配存档端口时固定 false（fail-closed） */
  save(slot: string, options?: SaveOptions): boolean { return save(this.ctx, slot, options); }
  /** 读档并恢复到档内检查点；返回是否成功 */
  load(slot: string): boolean { return load(this.ctx, slot); }
  /** 切换语言：异步载入语言包并整表重建译文表；失败时保持原语言并发错误事件 */
  async setLanguage(lang: string): Promise<void> { return setLanguage(this.ctx, lang); }
  /** 销毁引擎：清掉挂起的等待定时器、中断外部接管；订阅退订由各注册方法返回的注销函数负责 */
  dispose(): void { dispose(this.ctx); }
  /** 当前舞台上的元素实例列表，供宿主渲染 */
  elements(): ElementInstance[] { return elements(this.ctx); }
  /** 按 target 筛选舞台元素实例 */
  findElements(target: string): ElementInstance[] { return findElements(this.ctx, target); }
  /** 文本插值：替换 `{var}` 占位符；不查译文表（译文替换在命令层调用点，先 translate 后插值） */
  interpolate(source: string): string { return interpolate(this.ctx, source); }
  /** 直接下发一批元素操作（外部玩法系统用，绕开脚本层）；返回是否全部执行成功（false = 已出站 engine.error 且状态已回滚） */
  runElementOps(ops: readonly Record<string, unknown>[]): boolean { return runElementOps(this.ctx, ops); }
  /** 上报小游戏结果，按挂起等待声明的成功/失败目标继续；没有挂起时返回 false */
  resolveMinigame(result: MinigameResult): boolean { return resolveMinigame(this.ctx, result); }
  /** 内部转发 → ./internal：清掉挂起等待的定时器 */
  private clearTimer(): void { clearTimer(this.ctx); }
  /** 上报外部玩法系统的接管结果，按挂起接管声明的分流目标继续 */
  resolveInteraction(system: string, result: InteractionResult): boolean { return resolveInteraction(this.ctx, system, result); }
  /** 内部转发 → ./internal：中断所有外部接管（导航、销毁、读档、回溯、热重载时用） */
  private abortExternalTakeovers(): void { abortExternalTakeovers(this.ctx); }
  /** 内部转发 → ./internal：中断当前玩法系统接管并清除挂起状态 */
  private abortInteraction(): void { abortInteraction(this.ctx); }
  /** 内部转发 → ./internal：中断当前小游戏挂载并清除挂起状态 */
  private abortMinigame(): void { abortMinigame(this.ctx); }
  /** 内部转发 → ./state：写全局用户键（系统键见 setSystem） */
  private setGlobal(key: string, value: unknown): void { setGlobal(this.ctx, key, value); }
  /** 内部转发 → ./state：写系统键（引擎自用，与用户键分开以便存档区分） */
  private setSystem(key: string, value: unknown): void { setSystem(this.ctx, key, value); }
  /** 内部转发 → ./state：静默写入（不触发观察事件），返回是否真的写入 */
  private setSilentKey(key: string, value: unknown): boolean { return setSilentKey(this.ctx, key, value); }
  /** 外部玩法系统的状态写入面：作用域化键与「是否触发观察事件」的四种组合 */
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
  /** 内部转发 → ./state：实例 z 合法性检查（上层据此拒绝非法命令） */
  private rejectBadInstanceZ(cmd: StoryCommand): boolean { return rejectBadInstanceZ(this.ctx, cmd); }
  /** 内部转发 → ./state：写入实例 z 字段 */
  private setInstanceZ(key: string, raw: unknown): void { setInstanceZ(this.ctx, key, raw); }
  /** 内部转发 → ./state：把一次状态写入镜像成 ValueChanged */
  private emit(key: string, value: unknown, scope: string): void { emitChange(this.ctx, key, value, scope); }
  /** 内部转发 → ./state：发布对外事件 */
  private emitEvent(payload: OutboundPayload): void { publishEvent(this.ctx, payload); }
  /** 内部转发 → ./state：发错误事件（诊断码 + 可读消息） */
  private fail(code: string, message: string): void { emitErrorEvent(this.ctx, code, message); }
  /** 内部转发 → ./i18n：翻译单条文本（未载入译文表时原样返回） */
  private translate(original: string): string { return translate(this.ctx, original); }
  /** 内部转发 → ./i18n：批量翻译元素实例上的可见文本 */
  private translateElements(instances: readonly ElementInstance[]): ElementInstance[] { return translateElements(this.ctx, instances); }
  /** 内部转发 → ./internal：按 id 取列定义 */
  private columnById(id: string): StoryColumn | undefined { return columnById(this.ctx, id); }
  /** 内部转发 → ./history：最近一个可重放检查点的光标（没有则为 null） */
  private lastReplayableCursor(): number | null { return lastReplayableCursor(this.ctx); }
  /** 内部转发 → ./history：当前列是否可重放（回溯与自动存档的判据之一） */
  private isCurrentColumnReplayable(): boolean { return isCurrentColumnReplayable(this.ctx); }
  /** 内部转发 → ./internal：进入指定列；返回是否进入成功 */
  private enterColumn(columnId: string): boolean { return enterColumn(this.ctx, columnId); }
  /** 内部转发 → ./dispatch：命令分发主循环（op 分发逻辑的唯一所有者） */
  private run(): void { runDispatch(this.ctx); }
  /** 内部转发 → ./history：等待帧对应的检查点坐标 */
  private checkpointCoord(waitingFrame: Frame): ColumnCoordinate { return checkpointCoord(this.ctx, waitingFrame); }
  /** 内部转发 → ./internal：压入一层循环帧；返回循环是否正常建立（空数组视为无迭代仍返回 true） */
  private pushIterateLoop(frame: Frame, cmd: StoryCommand, items: ExprValue[]): boolean { return pushIterateLoop(this.ctx, frame, cmd, items); }
  /** 内部转发 → ./internal：开始一轮循环迭代；返回是否成功开始（超迭代上限 fail-closed 返回 false） */
  private beginLoopIteration(frame: Frame, loop: LoopState): boolean { return beginLoopIteration(this.ctx, frame, loop); }
  /** 内部转发 → ./internal：定位当前最近的循环帧下标（loop 中断用） */
  private nearestLoopIndex(): number { return nearestLoopIndex(this.ctx); }
  /** 内部转发 → ./internal：条件表达式求值；null = 求值失败（已发诊断） */
  private evalCond(src: unknown): boolean | null { return evalCond(this.ctx, src); }
  /** 查角色定义（character op 注册；say 的 speaker 按它套样式） */
  getCharacter(key: string): CharacterDef | undefined { return getCharacter(this.ctx, key); }
  /** 全部已注册的角色定义 */
  getCharacters(): CharacterDef[] { return getCharacters(this.ctx); }
  /** 内部转发 → ./internal：整体改写舞台的元素实例列表 */
  private mapElements(mapper: (el: ElementInstance) => ElementInstance): ElementInstance[] { return mapElements(this.ctx, mapper); }
  /** 当前待播的元素动画清单（宿主按 seq 驱动并回报 animationFinished） */
  animations(): AnimationSpec[] { return animations(this.ctx); }
  /** 宿主回报：序号为 seq 的动画已播完 */
  animationFinished(seq: number): void { animationFinished(this.ctx, seq); }
  /** 宿主回报：转场动画已播完 */
  transitionFinished(): void { transitionFinished(this.ctx); }
  /** 宿主回报：震屏已结束 */
  shakeFinished(): void { shakeFinished(this.ctx); }
  /** 宿主回报：视频播放结束 */
  videoFinished(): void { videoFinished(this.ctx); }
  /** 宿主回报：当前媒体已播到第 seconds 秒（存档定位与等待媒体命令的判据） */
  reportMediaPosition(seconds: number): void { reportMediaPosition(this.ctx, seconds); }
  /** 提交 input 命令等待的文本；当前没有 input 等待时 fail-closed（发 input-invalid，不写入） */
  input(value: string): void { input(this.ctx, value); }
  /** 内部转发 → ./internal：当前列的执行帧 */
  private columnFrame(): Frame | undefined { return columnFrame(this.ctx); }
  /** 内部转发 → ./internal：按坐标取执行帧（回溯重建用） */
  private columnFrameAt(coord: ColumnCoordinate): Frame { return columnFrameAt(this.ctx, coord); }
  /** 导出当前进度为存档数据（不落盘，写到哪由宿主决定）；不在等待点、菜单场景缺少回退坐标、载荷不可序列化时返回 null 并发诊断 */
  exportSave(): SaveDataV1 | null { return exportSave(this.ctx); }
  /** 从存档数据恢复进度；旧版本先走迁移钩子，迁移不了返回 false */
  importSave(data: SaveDataV1): boolean { return importSave(this.ctx, data); }
  /** 内部转发 → ./save：旧版本存档迁移；未注入迁移钩子时拒绝 */
  private tryMigrateSave(data: SaveDataV1): SaveDataV1 | null { return tryMigrateSave(this.ctx, data); }
  /** 内部转发 → ./save：校对本档所需扩展是否齐备；无标记时原样返回状态，标记非法/扩展缺失/版本迁移失败返回 null（已发 engine.error） */
  private resolveSaveExtensions(data: SaveDataV1): [string, unknown][] | null { return resolveSaveExtensions(this.ctx, data); }
  /** 内部转发 → ./save：按档内标记恢复扩展状态 */
  private restoreSaveExtensions(marks: SaveDataV1["extensions"]): boolean { return restoreSaveExtensions(this.ctx, marks); }
  /** 内部转发 → ./history：按坐标拍一份检查点快照 */
  private takeSnapshot(coord: ColumnCoordinate): Checkpoint { return takeSnapshot(this.ctx, coord); }
  /** 内部转发 → ./history：从检查点恢复状态 */
  private restore(cp: Checkpoint): void { restore(this.ctx, cp); }
  /** 内部转发 → ./history：把检查点归档进历史（未回溯且超出上限时从最旧端丢弃） */
  private commitCheckpoint(cp: Checkpoint): void { commitCheckpoint(this.ctx, cp); }
  /** 内部转发 → ./history：检查点处的自动存档 */
  private autoSaveAtCheckpoint(): void { autoSaveAtCheckpoint(this.ctx); }
  /** 内部转发 → ./history：提交挂起的检查点（等玩家看过的画面解除等待后才入档） */
  private flushPendingCheckpoint(): void { flushPendingCheckpoint(this.ctx); }
  /** 回溯到历史检查点：给下标表示第几个，给坐标表示取该坐标之前最近的检查点（非精确定位；找不到即报错） */
  rollbackTo(target: number | ColumnCoordinate): void { rollbackTo(this.ctx, target); }
  /** 已归档的检查点数量 */
  historyLength(): number { return historyLength(this.ctx); }
  /** 当前光标：最后归档的检查点下标（回溯后会小于 historyLength - 1） */
  historyCursor(): number { return historyCursor(this.ctx); }
  /** 历史后退一格（回到上一个已归档检查点） */
  back(): void { back(this.ctx); }
  /** 历史前进一格；已到末尾或分岔后前向被截断时 fail-closed 报 no-forward */
  forward(): void { forward(this.ctx); }
  /** 热重载：原子替换故事定义，后续推进基于新定义 */
  reloadStory(story: Story): void { reloadStory(this.ctx, story); }
  /** 历史浏览视图：逐条给出序号、坐标、说话人与文本（nvl 另带多行） */
  historyView(): Array<{ index: number; coord: ColumnCoordinate; speaker: string; text: string; nvl: boolean; nvlLines: string[]; }> { return historyView(this.ctx); }
  /** 内部转发 → ./internal：取一个确定性随机数 [0,1)（mulberry32，状态进快照，重放序列一致） */
  private draw(): number { return draw(this.ctx); }
  /** 内部转发 → ./state：表达式求值（Value 口径） */
  private evalValue(raw: unknown): ExprValue { return evalValue(this.ctx, raw); }
  /** 内部转发 → ./state：读取变量（作用域链 → 全局） */
  private readVariable(key: string): ExprValue { return readVariable(this.ctx, key); }
  /** 名字解析端口：表达式与插值靠它取值，求值器因此不必接触本类内部 */
  private resolveName: NameResolver = (
    name: string,
  ): { found: true; value: unknown } | { found: false } => resolveName(this.ctx, name);
}

/**
 * 执行模型：SSOT 状态容器 + 帧栈式逐命令解释执行 + advance/choose 命令面。
 * 作用域：块/列级 Scope 树 + 全局（SSOT Map）；块/列级不进存档。
 * 框架无关：只写状态与事件，渲染归 UI 层。
 */
import type {
  AnimationSpec,
  CharacterDef,
  ColumnCoordinate,
  ColumnSummary,
  ElementInstance,
  EngineOptions,
  EventListener,
  MinigameResult,
  SaveDataV1,
  StateListener,
  Story,
  StoryCommand,
  SaveOptions,
} from "../contracts/index.ts";
import {
  SYS,
  type ExtensionOpResult,
  type GameStateWriter,
  type InteractionResult,
} from "../contracts/index.ts";
import {
  resolveExtensionOp,
  resolveInteraction,
  resolveMinigame,
  runElementOps,
  submitSceneOps,
} from "./ops/index.ts";
import {
  back,
  forward,
  historyCursor,
  historyLength,
  historyView,
  rollbackTo,
  type HistoryViewEntry,
} from "./history/index.ts";
import { exportSave, importSave } from "./save/index.ts";
import { pauseSession, resumeSession } from "./session/index.ts";
import { columnSummaries } from "./engine/columns.ts";
import {
  advance,
  advanceAutomated,
  animationFinished,
  animations,
  autoActive,
  choose,
  dispose,
  elements,
  findElements,
  getCharacter,
  getCharacters,
  hydratePersistentData,
  input,
  interpolate,
  isSeenCoord,
  load,
  navigate,
  onEvent,
  onStateChanged,
  pausedSession,
  reloadStory,
  reportMediaPosition,
  save,
  setAuto,
  setLanguage,
  setSkip,
  shakeFinished,
  skipActive,
  start,
  transitionFinished,
  videoFinished,
  type OpContext,
} from "./internal/index.ts";
import { EngineForwarders, createGameState } from "./engine/index.ts";
import {
  deriveValue,
  markLegacySurfaces,
  resetSuspected,
  translate,
} from "./i18n/index.ts";

/**
 * 装配契约（构造选项与守卫）定义在契约层，此处按原路径转出，
 * 既有消费方无需改动即可继续从本模块取；后续并入包出口时统一改走包出口。
 */
export type {
  EngineOptions,
  GuardContext,
  GuardFn,
} from "../contracts/index.ts";

/**
 * 叙事引擎的公开门面与命令面。
 *
 * 职责边界：状态字段与构造期装配在 `EngineCore`（`./engine/state.ts`），私有面转发器在
 * `EngineForwarders`（`./engine/forwarders.ts`）；本类只保留「命令面 + `ctx` 通道 + 对外薄转发」。
 * 命令解释、状态写入、历史回溯、存档编排、国际化各自实现在 `./internal`、`./state`、`./history`、
 * `./save`、`./ops`、`./i18n`，命令分发主循环在 `./dispatch`。这些自由函数统一拿 `OpContext`
 * （即本类经 {@link StoryEngine.buildOpContext} 断言出来的私有面视图）读写基类上的状态与转发器。
 * 因此：**改行为去目标模块改，改字段含义看 `./engine/state.ts`，改转发面看 `./engine/forwarders.ts`**。
 *
 * 推进模型：`start()` 进入口列，`advance()` / `choose()` 推进到下一个玩家可见状态；
 * 等待型命令挂起后由宿主回调解除（`animationFinished()` / `input()` /
 * `resolveMinigame()` 等）。本类不持有 DOM，全部产出经 `onStateChanged()` 与
 * `onEvent()` 两条观察接缝送出；销毁走 `dispose()`。
 */
export class StoryEngine extends EngineForwarders {
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
      this.extensionWaitSeq,
      // 实例 z 校验与落账
      this.rejectBadInstanceZ,
      this.setInstanceZ,
      // 检查点与历史回溯
      this.checkpointCoord,
      this.takeSnapshot,
      this.restore,
      this.autoSaveAtCheckpoint,
      this.historyLimit,
      this.rollbackEnabled,
      this.historyLimitNotice,
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
      this.resolveSaveMinigames,
      this.restoreSaveExtensions,
      // 外部玩法系统的状态写入面
      this.gameState,
      this.pendingMinigame,
      this.minigameController,
      this.pendingInteraction,
      this.interactionController,
      this.pendingExtensionOp,
      this.extensionController,
      this.functions,
      this.usedExtensions,
      this.usedMinigames,
      this.deleted,
      this.minigameById,
      this.migrateStateHook,
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
      this.pendingTimerDueAt,
      this.pausedTimerRemainingMs,
      this.waitSkipable,
      this.timerPort,
      this.texts,
      this.characters,
      this.inputStore,
      this.rollbackActive,
      this.pendingSay,
      this.rngState,
      this.videoSeq,
      this.savePort,
      this.saveMode,
      // 机器级持久数据与 skip/auto 会话模式（只经 ctx 被迁出的自由函数读写）
      this.persistentPort,
      this.persistent,
      this.autoOn,
      this.skipOn,
      // 工程级配置（非状态）
      this.audioConfig,
      this.i18nPort,
      this.clearTimer,
      this.abortExternalTakeovers,
      this.abortInteraction,
      this.abortMinigame,
      this.abortExtensionOp,
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
   * 装配引擎：`super()` 登记故事定义、各端口与扩展（选项语义见 `EngineCore` 构造器），
   * 随后建好 `ctx` 私有面通道。
   *
   * 选项全部可省：缺省时历史上限 200、随机种子取当前时间、存档模式 `machine-bound`，
   * 且没有存档 / 国际化 / 守卫 / 扩展。缺端口不影响推进，只让对应命令面 fail-closed
   * （例如没有存档端口时 `save()` 固定返回 false）。
   */
  constructor(story: Story, options?: EngineOptions) {
    super(story, options);
    this.ctx = this.buildOpContext();
  }

  // —— 观察接缝 ——

  /** ValueChanged 是唯一观察接缝；所有状态写入都经 set 系方法镜像到这里 */
  onStateChanged(listener: StateListener): () => void {
    return onStateChanged(this.ctx, listener);
  }
  /** 订阅对外事件（进度事件与错误事件同路）。返回退订函数 */
  onEvent(listener: EventListener): () => void {
    return onEvent(this.ctx, listener);
  }
  /**
   * 读 SSOT 里的当前值；从未写过的键返回 undefined。只读，不触发观察事件。
   * 派生键给当前语言译文（出站/读口/投影三处同源之一）：状态里是原文，展示值读时派生；
   * StateReader 经此读口取数，宿主渲染层零查表。
   */
  get(key: string): unknown {
    return deriveValue(this.ctx, key, this.state.get(key));
  }

  // —— 列清单 ——

  /**
   * 故事列清单的只读摘要（顺序同故事定义）：宿主据此列章节、判当前页、决定跳哪。
   *
   * **每次调用都返回新数组**，元素是冻结对象——调用方随手 `push` / 改字段都碰不到引擎。
   * 不含 `commands` / `elements` / `entry`：那部分归引擎解释，宿主不应自己再解释一遍。
   * 热重载后重新调用即得新清单（不要缓存返回值跨重载使用）。
   */
  columns(): readonly ColumnSummary[] {
    return columnSummaries(this.story);
  }

  // —— 命令面 ——
  // 公开方法都是转交给实现模块的薄壳，语义与错误处理以目标模块为准；夹在其中的
  // private 成员是同一转发模式的内部版本，供迁出的自由函数经 ctx 回调本类私有面。

  /** story.start：导航至入口列（entry 取自 project.json） */
  start(): void {
    start(this.ctx);
  }
  /** 推进到下一个玩家可见状态（宿主「继续」入口）：仅对话等待、可跳过的 wait、可跳过的视频播放有效，其余 fail-closed 发 advance-invalid */
  advance(): void {
    advance(this.ctx);
  }
  /**
   * 自动播放模式开关（会话态，不进快照/存档）。与快进互斥。
   * 延时节奏由宿主按偏好 autoDelayMs 装配（打字机完成后延时 advanceAutomated）。
   */
  auto(on: boolean): void {
    setAuto(this.ctx, on);
  }
  /**
   * 快进模式开关（会话态，不进快照/存档）。与自动互斥。
   * 快进节奏由宿主按偏好 skipDelayMs 装配（按住持续 advanceAutomated）。
   */
  skip(on: boolean): void {
    setSkip(this.ctx, on);
  }
  /** 当前是否处于自动播放模式 */
  autoActive(): boolean {
    return autoActive(this.ctx);
  }
  /** 当前是否处于快进模式 */
  skipActive(): boolean {
    return skipActive(this.ctx);
  }
  /**
   * skip/auto 驱动的 guarded 推进：走与玩家点击同一条推进接缝（检查点时机不变），
   * 叠加回溯期/ui 列/noskip/未读停闸门，任一命中即停模式返回 false。
   * skipUnseenOnly 由宿主按偏好传入。玩家手动 advance 不受这些闸门限制。
   */
  advanceAutomated(options?: { skipUnseenOnly?: boolean }): boolean {
    return advanceAutomated(this.ctx, options);
  }
  /** 查询某坐标是否已读（机器级已读记录，跨存档共享） */
  isSeen(coord: ColumnCoordinate): boolean {
    return isSeenCoord(this.ctx, coord);
  }
  /** 从持久端口加载已读记录并合并进内存（逐项降级，读取失败按空白降级不挡启动） */
  async hydratePersistent(): Promise<void> {
    return hydratePersistentData(this.ctx);
  }
  /** 提交选项答案；选项挂起期间有效，optionId 取自 choices 事件载荷 */
  choose(optionId: string): void {
    choose(this.ctx, optionId);
  }
  /** 直接跳转到指定列，不经过流程控制命令 */
  navigate(columnId: string): void {
    navigate(this.ctx, columnId);
  }
  /** 写档到槽位；返回是否成功。未装配存档端口时固定 false（fail-closed） */
  save(slot: string, options?: SaveOptions): boolean {
    return save(this.ctx, slot, options);
  }
  /** 读档并恢复到档内检查点；返回是否成功 */
  load(slot: string): boolean {
    return load(this.ctx, slot);
  }
  /** 切换语言：异步载入语言包并整表重建译文表；失败时保持原语言并发错误事件 */
  async setLanguage(lang: string): Promise<void> {
    return setLanguage(this.ctx, lang);
  }
  /** 销毁引擎：清掉挂起的等待定时器、中断外部接管；订阅退订由各注册方法返回的注销函数负责 */
  dispose(): void {
    dispose(this.ctx);
  }
  /**
   * 暂停：挂起等待定时器、让正在出声的媒体收声、记下暂停标记。
   *
   * 幂等。**不中断外部接管**（小游戏 / 玩法系统 / 扩展 op 等待保持挂载，只是不再收到推进输入），
   * 否则再恢复就不是「接着玩」而是「重进」。暂停期间 `advance()` / `choose()` fail-closed。
   */
  pause(): void {
    pauseSession(this.ctx);
  }
  /** 解除暂停：按剩余毫秒续上原来的等待，媒体按当前状态逐个恢复。未暂停时幂等空操作 */
  resume(): void {
    resumeSession(this.ctx);
  }
  /** 是否处于暂停中 */
  paused(): boolean {
    return pausedSession(this.ctx);
  }
  /** 当前舞台上的元素实例列表，供宿主渲染 */
  elements(): ElementInstance[] {
    return elements(this.ctx);
  }
  /** 按 target 筛选舞台元素实例 */
  findElements(target: string): ElementInstance[] {
    return findElements(this.ctx, target);
  }
  /** 文本插值：替换 `{var}` 占位符；不查译文表（译文替换在命令层调用点，先 translate 后插值） */
  interpolate(source: string): string {
    return interpolate(this.ctx, source);
  }
  /** 翻译单条文本：查当前语言译文表（原文 → 译文），与命令层翻译走同一查表；未装配译文表或未命中回退原文，空串直返 */
  translate(text: string): string {
    return translate(this.ctx, text);
  }
  /** 直接下发一批元素操作（外部玩法系统用，绕开脚本层）；返回是否全部执行成功（false = 已出站 engine.error 且状态已回滚） */
  runElementOps(ops: readonly Record<string, unknown>[]): boolean {
    return runElementOps(this.ctx, ops);
  }
  /**
   * 提交一批命令给引擎执行（列身体等外部画面用，绕开脚本层）。
   *
   * 与 `runElementOps` 的区别：一是不要求当前有等待画面——列身体在进列那刻就可能没有
   * 任何等待态（纯视觉房间）；二是允许 `say` 并停在对话等待态。其余语义一致：不建检查点、
   * 整次拒绝位置类与存档类 op、失败整份回滚、返回是否全部执行成功。
   */
  submitSceneOps(ops: readonly StoryCommand[]): boolean {
    return submitSceneOps(this.ctx, ops);
  }
  /** 上报小游戏结果，按挂起等待声明的成功/失败目标继续；没有挂起时返回 false */
  resolveMinigame(result: MinigameResult): boolean {
    return resolveMinigame(this.ctx, result);
  }
  /** 上报外部玩法系统的接管结果，按挂起接管声明的分流目标继续 */
  resolveInteraction(system: string, result: InteractionResult): boolean {
    return resolveInteraction(this.ctx, system, result);
  }
  /** 上报扩展 op 的等待结果，按挂起等待声明的分流目标继续；op 不符/无挂起时返回 false */
  resolveExtensionOp(op: string, result: ExtensionOpResult): boolean {
    return resolveExtensionOp(this.ctx, op, result);
  }
  /** 外部玩法系统的状态写入面：作用域化键与「是否触发观察事件」的四种组合 */
  readonly gameState: GameStateWriter = createGameState(
    (key, value, emitChange, systemId) =>
      this.writeExternal(key, value, emitChange, systemId),
    (key) => this.state.get(key),
  );
  /** 查角色定义（character op 注册；say 的 speaker 按它套样式） */
  getCharacter(key: string): CharacterDef | undefined {
    return getCharacter(this.ctx, key);
  }
  /** 全部已注册的角色定义 */
  getCharacters(): CharacterDef[] {
    return getCharacters(this.ctx);
  }
  /** 当前待播的元素动画清单（宿主按 seq 驱动并回报 animationFinished） */
  animations(): AnimationSpec[] {
    return animations(this.ctx);
  }
  /** 宿主回报：序号为 seq 的动画已播完 */
  animationFinished(seq: number): void {
    animationFinished(this.ctx, seq);
  }
  /** 宿主回报：转场动画已播完 */
  transitionFinished(): void {
    transitionFinished(this.ctx);
  }
  /** 宿主回报：震屏已结束 */
  shakeFinished(): void {
    shakeFinished(this.ctx);
  }
  /** 宿主回报：视频播放结束 */
  videoFinished(): void {
    videoFinished(this.ctx);
  }
  /** 宿主回报：当前媒体已播到第 seconds 秒（存档定位与等待媒体命令的判据） */
  reportMediaPosition(seconds: number): void {
    reportMediaPosition(this.ctx, seconds);
  }
  /** 提交 input 命令等待的文本；当前没有 input 等待时 fail-closed（发 input-invalid，不写入） */
  input(value: string): void {
    input(this.ctx, value);
  }
  /** 导出当前进度为存档数据（不落盘，写到哪由宿主决定）；不在等待点、菜单场景缺少回退坐标、载荷不可序列化时返回 null 并发诊断 */
  exportSave(): SaveDataV1 | null {
    return exportSave(this.ctx);
  }
  /**
   * 从存档数据恢复进度；旧版本先走迁移钩子，迁移不了返回 false。
   * 老存档（无源键）读入后对残留译文表面打疑似译文标记（内存，不改存档格式）；
   * 检测必须先于恢复——读档重放会写入源键，事后检测会失真。
   * 坏载荷（state 非数组）不打标记，交由 importSave 校验统一拒绝，保持 fail-closed。
   */
  importSave(data: SaveDataV1): boolean {
    const legacy =
      Array.isArray(data.state) &&
      !data.state.some(([key]) => key === SYS.i18nSources);
    const ok = importSave(this.ctx, data);
    if (ok) {
      if (legacy) markLegacySurfaces(this.ctx);
      else resetSuspected(this.ctx);
    }
    return ok;
  }
  /** 回溯到历史检查点：给下标表示第几个，给坐标表示取该坐标之前最近的检查点（非精确定位；找不到即报错） */
  rollbackTo(target: number | ColumnCoordinate): void {
    rollbackTo(this.ctx, target);
  }
  /** 已归档的检查点数量 */
  historyLength(): number {
    return historyLength(this.ctx);
  }
  /** 当前光标：最后归档的检查点下标（回溯后会小于 historyLength - 1） */
  historyCursor(): number {
    return historyCursor(this.ctx);
  }
  /** 历史后退一格（回到上一个已归档检查点） */
  back(): void {
    back(this.ctx);
  }
  /** 历史前进一格；已到末尾或分岔后前向被截断时 fail-closed 报 no-forward */
  forward(): void {
    forward(this.ctx);
  }
  /**
   * 当前是否允许回退（宿主回退控件的唯一读面）：工程总开关 rollbackEnabled 打开，
   * 且未被 op 级临时锁定（SYS.rollbackLocked）。宿主据此隐藏/禁用回退入口与滚轮回退，
   * 不另算一份；引擎 back/forward/rollbackTo 自身也 fail-closed 拒，二者同源。
   */
  rollbackAvailable(): boolean {
    return this.rollbackEnabled && this.get(SYS.rollbackLocked) !== true;
  }
  /** 热重载：原子替换故事定义，后续推进基于新定义 */
  reloadStory(story: Story): void {
    reloadStory(this.ctx, story);
  }
  /** 历史浏览视图：逐条给出序号、坐标、说话人与文本（nvl 另带多行） */
  historyView(): HistoryViewEntry[] {
    return historyView(this.ctx);
  }
}

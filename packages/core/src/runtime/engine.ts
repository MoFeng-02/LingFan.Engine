/**
 * 执行模型：SSOT 状态容器 + 帧栈式逐命令解释执行 + advance/choose 命令面。
 * 作用域：块/列级 Scope 树 + 全局（SSOT Map）；块/列级不进存档。
 * 框架无关：只写状态与事件，渲染归 UI 层。
 */
import type {
  AnimationSpec,
  CharacterDef,
  ColumnCoordinate,
  ElementInstance,
  EngineOptions,
  EventListener,
  MinigameResult,
  SaveDataV1,
  StateListener,
  Story,
  SaveOptions,
} from "../contracts/index.ts";
import {
  gameScopedKey,
  type ExtensionOpResult,
  type GameStateWriter,
  type InteractionResult,
} from "../contracts/index.ts";
import {
  resolveExtensionOp,
  resolveInteraction,
  resolveMinigame,
  runElementOps,
} from "./ops/index.ts";
import {
  back,
  forward,
  historyCursor,
  historyLength,
  historyView,
  rollbackTo,
} from "./history/index.ts";
import { exportSave, importSave } from "./save/index.ts";
import {
  advance,
  animationFinished,
  animations,
  choose,
  dispose,
  elements,
  findElements,
  getCharacter,
  getCharacters,
  input,
  interpolate,
  load,
  navigate,
  onEvent,
  onStateChanged,
  reloadStory,
  reportMediaPosition,
  save,
  setLanguage,
  shakeFinished,
  start,
  transitionFinished,
  videoFinished,
  type OpContext,
} from "./internal/index.ts";
import { EngineForwarders } from "./engine/index.ts";

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
  /** 读 SSOT 里的当前值；从未写过的键返回 undefined。只读，不触发观察事件 */
  get(key: string): unknown {
    return this.state.get(key);
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
  /** 直接下发一批元素操作（外部玩法系统用，绕开脚本层）；返回是否全部执行成功（false = 已出站 engine.error 且状态已回滚） */
  runElementOps(ops: readonly Record<string, unknown>[]): boolean {
    return runElementOps(this.ctx, ops);
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
  readonly gameState: GameStateWriter = {
    set: (key: string, value: unknown): boolean =>
      this.writeExternal(key, value, true),
    setSilent: (key: string, value: unknown): boolean =>
      this.writeExternal(key, value, false),
    setScoped: (systemId: string, key: string, value: unknown): boolean =>
      this.writeExternal(gameScopedKey(systemId, key), value, true, systemId),
    setScopedSilent: (systemId: string, key: string, value: unknown): boolean =>
      this.writeExternal(gameScopedKey(systemId, key), value, false, systemId),
    get: (key: string): unknown => this.state.get(key),
  };
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
  /** 从存档数据恢复进度；旧版本先走迁移钩子，迁移不了返回 false */
  importSave(data: SaveDataV1): boolean {
    return importSave(this.ctx, data);
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
  /** 热重载：原子替换故事定义，后续推进基于新定义 */
  reloadStory(story: Story): void {
    reloadStory(this.ctx, story);
  }
  /** 历史浏览视图：逐条给出序号、坐标、说话人与文本（nvl 另带多行） */
  historyView(): Array<{
    index: number;
    coord: ColumnCoordinate;
    speaker: string;
    text: string;
    nvl: boolean;
    nvlLines: string[];
  }> {
    return historyView(this.ctx);
  }
}

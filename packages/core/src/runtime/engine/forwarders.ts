/**
 * 引擎私有面转发器：把 `./internal`、`./state`、`./history`、`./save`、`./ops`、`./i18n` 的自由函数
 * 重新暴露成 `OpContext` 上的成员，供命令处理器与执行器经 `ctx` 回调引擎。
 *
 * 为什么是类成员而不是模块级函数：`StoryEngine` 用 `this as unknown as OpContext` 把**自身实例**当通道，
 * 自由函数对 `ctx.state` / `ctx.coord` / `ctx.pendingTimer` 等的写入必须落到真实字段上；
 * 换成返回新对象的工厂就会把写操作丢在临时对象里（值语义），因此只能留在类内、靠继承拿到字段。
 *
 * 这些成员只应被 `ctx` 通道调用；直接 import 本类不构成使用理由。改行为去目标模块，改字段含义看 `./state.ts`。
 */
import {
  abortExternalTakeovers,
  beginLoopIteration,
  clearTimer,
  columnById,
  draw,
  enterColumn,
  evalCond,
  mapElements,
  nearestLoopIndex,
  pushIterateLoop,
  type Checkpoint,
  type Frame,
  type LoopState,
} from "../internal/index.ts";
import {
  abortExtensionOp,
  abortInteraction,
  abortMinigame,
} from "../ops/index.ts";
import {
  emitChange,
  emitErrorEvent,
  evalValue,
  publishEvent,
  readVariable,
  rejectBadInstanceZ,
  resolveName,
  setGlobal,
  setInstanceZ,
  setSilentKey,
  setSystem,
  writeExternal,
} from "../state/index.ts";
import { translate, translateElements } from "../i18n/index.ts";
import {
  autoSaveAtCheckpoint,
  checkpointCoord,
  columnFrame,
  columnFrameAt,
  commitCheckpoint,
  flushPendingCheckpoint,
  isCurrentColumnReplayable,
  lastReplayableCursor,
  restore,
  takeSnapshot,
} from "../history/index.ts";
import { runDispatch } from "../dispatch.ts";
import { type ExprValue } from "../expr/index.ts";
import {
  resolveSaveExtensions,
  resolveSaveMinigames,
  restoreSaveExtensions,
  tryMigrateSave,
} from "../save/index.ts";
import { type NameResolver } from "../resolver.ts";
import type {
  ColumnCoordinate,
  ElementInstance,
  OutboundPayload,
  SaveDataV1,
  StoryColumn,
  StoryCommand,
} from "../../contracts/index.ts";
import { EngineCore } from "./state.ts";

export abstract class EngineForwarders extends EngineCore {
  // —— 私有面转发器（供迁出的自由函数经 `ctx` 回调本层） ——
  /** 内部转发 → ./internal：清掉挂起等待的定时器 */
  protected clearTimer(): void {
    clearTimer(this.ctx);
  }
  /** 内部转发 → ./internal：中断所有外部接管（导航、销毁、读档、回溯、热重载时用） */
  protected abortExternalTakeovers(): void {
    abortExternalTakeovers(this.ctx);
  }
  /** 内部转发 → ./internal：中断当前玩法系统接管并清除挂起状态 */
  protected abortInteraction(): void {
    abortInteraction(this.ctx);
  }
  /** 内部转发 → ./internal：中断当前小游戏挂载并清除挂起状态 */
  protected abortMinigame(): void {
    abortMinigame(this.ctx);
  }
  /** 内部转发 → ./internal：中断当前扩展 op 等待并清除挂起状态 */
  protected abortExtensionOp(): void {
    abortExtensionOp(this.ctx);
  }
  /** 内部转发 → ./state：写全局用户键（系统键见 setSystem） */
  protected setGlobal(key: string, value: unknown): void {
    setGlobal(this.ctx, key, value);
  }
  /** 内部转发 → ./state：写系统键（引擎自用，与用户键分开以便存档区分） */
  protected setSystem(key: string, value: unknown): void {
    setSystem(this.ctx, key, value);
  }
  /** 内部转发 → ./state：静默写入（不触发观察事件），返回是否真的写入 */
  protected setSilentKey(key: string, value: unknown): boolean {
    return setSilentKey(this.ctx, key, value);
  }
  /**
   * 外部写入的公共实现：键校验（保留键 + 命名空间合法性）→ 值契约 → 落 SSOT。
   * `emitChange = false` 走静默通道（帧级高频写）。
   */
  protected writeExternal(
    key: string,
    value: unknown,
    emitChange: boolean,
    systemId?: string,
  ): boolean {
    return writeExternal(this.ctx, key, value, emitChange, systemId);
  }
  /** 内部转发 → ./state：实例 z 合法性检查（上层据此拒绝非法命令） */
  protected rejectBadInstanceZ(cmd: StoryCommand): boolean {
    return rejectBadInstanceZ(this.ctx, cmd);
  }
  /** 内部转发 → ./state：写入实例 z 字段 */
  protected setInstanceZ(key: string, raw: unknown): void {
    setInstanceZ(this.ctx, key, raw);
  }
  /** 内部转发 → ./state：把一次状态写入镜像成 ValueChanged */
  protected emit(key: string, value: unknown, scope: string): void {
    emitChange(this.ctx, key, value, scope);
  }
  /** 内部转发 → ./state：发布对外事件 */
  protected emitEvent(payload: OutboundPayload): void {
    publishEvent(this.ctx, payload);
  }
  /** 内部转发 → ./state：发错误事件（诊断码 + 可读消息） */
  protected fail(code: string, message: string): void {
    emitErrorEvent(this.ctx, code, message);
  }
  /** 内部转发 → ./i18n：翻译单条文本（未载入译文表时原样返回） */
  protected translate(original: string): string {
    return translate(this.ctx, original);
  }
  /** 内部转发 → ./i18n：批量翻译元素实例上的可见文本 */
  protected translateElements(
    instances: readonly ElementInstance[],
  ): ElementInstance[] {
    return translateElements(this.ctx, instances);
  }
  /** 内部转发 → ./internal：按 id 取列定义 */
  protected columnById(id: string): StoryColumn | undefined {
    return columnById(this.ctx, id);
  }
  /** 内部转发 → ./history：最近一个可重放检查点的光标（没有则为 null） */
  protected lastReplayableCursor(): number | null {
    return lastReplayableCursor(this.ctx);
  }
  /** 内部转发 → ./history：当前列是否可重放（回溯与自动存档的判据之一） */
  protected isCurrentColumnReplayable(): boolean {
    return isCurrentColumnReplayable(this.ctx);
  }
  /** 内部转发 → ./internal：进入指定列；返回是否进入成功 */
  protected enterColumn(columnId: string): boolean {
    return enterColumn(this.ctx, columnId);
  }
  /** 内部转发 → ./dispatch：命令分发主循环（op 分发逻辑的唯一所有者） */
  protected run(): void {
    runDispatch(this.ctx);
  }
  /** 内部转发 → ./history：等待帧对应的检查点坐标 */
  protected checkpointCoord(waitingFrame: Frame): ColumnCoordinate {
    return checkpointCoord(this.ctx, waitingFrame);
  }
  /** 内部转发 → ./internal：压入一层循环帧；返回循环是否正常建立（空数组视为无迭代仍返回 true） */
  protected pushIterateLoop(
    frame: Frame,
    cmd: StoryCommand,
    items: ExprValue[],
  ): boolean {
    return pushIterateLoop(this.ctx, frame, cmd, items);
  }
  /** 内部转发 → ./internal：开始一轮循环迭代；返回是否成功开始（超迭代上限 fail-closed 返回 false） */
  protected beginLoopIteration(frame: Frame, loop: LoopState): boolean {
    return beginLoopIteration(this.ctx, frame, loop);
  }
  /** 内部转发 → ./internal：定位当前最近的循环帧下标（loop 中断用） */
  protected nearestLoopIndex(): number {
    return nearestLoopIndex(this.ctx);
  }
  /** 内部转发 → ./internal：条件表达式求值；null = 求值失败（已发诊断） */
  protected evalCond(src: unknown): boolean | null {
    return evalCond(this.ctx, src);
  }
  /** 内部转发 → ./internal：整体改写舞台的元素实例列表 */
  protected mapElements(
    mapper: (el: ElementInstance) => ElementInstance,
  ): ElementInstance[] {
    return mapElements(this.ctx, mapper);
  }
  /** 内部转发 → ./internal：当前列的执行帧 */
  protected columnFrame(): Frame | undefined {
    return columnFrame(this.ctx);
  }
  /** 内部转发 → ./internal：按坐标取执行帧（回溯重建用） */
  protected columnFrameAt(coord: ColumnCoordinate): Frame {
    return columnFrameAt(this.ctx, coord);
  }
  /** 内部转发 → ./save：旧版本存档迁移；未注入迁移钩子时拒绝 */
  protected tryMigrateSave(data: SaveDataV1): SaveDataV1 | null {
    return tryMigrateSave(this.ctx, data);
  }
  /** 内部转发 → ./save：校对本档所需扩展是否齐备；无标记时原样返回状态，标记非法/扩展缺失/版本迁移失败返回 null（已发 engine.error） */
  protected resolveSaveExtensions(
    data: SaveDataV1,
  ): [string, unknown][] | null {
    return resolveSaveExtensions(this.ctx, data);
  }
  /** 内部转发 → ./save：按档内标记恢复扩展状态 */
  protected restoreSaveExtensions(marks: SaveDataV1["extensions"]): boolean {
    return restoreSaveExtensions(this.ctx, marks);
  }
  /** 内部转发 → ./save/minigames：校验档内玩法系统依赖并迁移其命名空间状态 */
  protected resolveSaveMinigames(
    entries: [string, unknown][],
    marks: SaveDataV1["minigames"],
  ): [string, unknown][] | null {
    return resolveSaveMinigames(this.ctx, entries, marks);
  }
  /** 内部转发 → ./history：按坐标拍一份检查点快照 */
  protected takeSnapshot(coord: ColumnCoordinate): Checkpoint {
    return takeSnapshot(this.ctx, coord);
  }
  /** 内部转发 → ./history：从检查点恢复状态 */
  protected restore(cp: Checkpoint): void {
    restore(this.ctx, cp);
  }
  /** 内部转发 → ./history：把检查点归档进历史（未回溯且超出上限时从最旧端丢弃） */
  protected commitCheckpoint(cp: Checkpoint): void {
    commitCheckpoint(this.ctx, cp);
  }
  /** 内部转发 → ./history：检查点处的自动存档 */
  protected autoSaveAtCheckpoint(): void {
    autoSaveAtCheckpoint(this.ctx);
  }
  /** 内部转发 → ./history：提交挂起的检查点（等玩家看过的画面解除等待后才入档） */
  protected flushPendingCheckpoint(): void {
    flushPendingCheckpoint(this.ctx);
  }
  /** 内部转发 → ./internal：取一个确定性随机数 [0,1)（mulberry32，状态进快照，重放序列一致） */
  protected draw(): number {
    return draw(this.ctx);
  }
  /** 内部转发 → ./state：表达式求值（Value 口径） */
  protected evalValue(raw: unknown): ExprValue {
    return evalValue(this.ctx, raw);
  }
  /** 内部转发 → ./state：读取变量（作用域链 → 全局） */
  protected readVariable(key: string): ExprValue {
    return readVariable(this.ctx, key);
  }
  /** 名字解析端口：表达式与插值靠它取值，求值器因此不必接触本类内部 */
  protected resolveName: NameResolver = (
    name: string,
  ): { found: true; value: unknown } | { found: false } =>
    resolveName(this.ctx, name);
}

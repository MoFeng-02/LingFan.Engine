/**
 * 02-执行模型：SSOT 状态容器 + 帧栈式逐命令解释执行 + advance/choose 命令面。
 * 04-作用域：块/列级 Scope 树 + 全局（SSOT Map）；块/列级不进存档（S3）。
 * 框架无关：只写状态与事件，渲染归 UI 层（08-U1）。
 */
import type {
  ColumnCoordinate,
  EventListener,
  OutboundEvent,
  OutboundPayload,
  SaveDataV1,
  StateListener,
  Story,
  StoryColumn,
  StoryCommand,
  ValueChanged,
} from "./contracts";
import { SYS } from "./contracts";
import {
  ExpressionError,
  evaluateExpression,
  exprEquals,
  interpolateText,
  type ExprValue,
} from "./expr";
import type { NameResolver } from "./resolver";
import { Scope } from "./scope";

/** say 的已知负载字段（01 §二.1）；未知字段 fail-closed（E3/F5） */
const SAY_KNOWN_FIELDS = new Set([
  "op",
  "text",
  "speaker",
  "clickable",
  "noskip",
  "instant",
  "typewriter",
  "voice",
  "template",
]);

const WAIT_FIELDS = new Set(["op", "seconds", "skipable"]);
const PAUSE_FIELDS = new Set(["op", "seconds"]);

/** set 复合赋值前缀（老规范 §6.2：value 支持 {expr} 与 += 等复合赋值） */
const COMPOUND_PREFIX = /^\s*(\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/;

/** 防死循环安全网：单个循环帧的迭代上限（新引擎增量，fail-closed） */
const LOOP_LIMIT = 10000;

/**
 * 03 §一 快照：状态 + rngState + 帧栈。
 * 不变量：状态容器的值写时复制（array/dict 每次写入新引用），故浅拷贝 entries 即安全。
 */
interface EngineSnapshot {
  state: [string, unknown][];
  rngState: number;
  frames: Frame[];
  coord: ColumnCoordinate;
  /** 04 §一.7 函数注册表随快照恢复——回溯到 func 之前的检查点重放时必须可重新注册 */
  functions: [string, { params: string[]; body: StoryCommand[] }][];
}

/** 03 §一 检查点 = 坐标 + 快照；重放 = 恢复快照后从该命令重新解释执行到同一等待点 */
interface Checkpoint {
  coord: ColumnCoordinate;
  snapshot: EngineSnapshot;
}

export interface EngineOptions {
  /** 03 §三.3 历史容量上限（默认 200），超限淘汰最旧 */
  historyLimit?: number;
  /** 03-R6 确定性随机：初始 rng 种子（缺省按当前时间） */
  rngSeed?: number;
}

function cloneFrame(f: Frame): Frame {
  return {
    columnId: f.columnId,
    commands: f.commands,
    index: f.index,
    scope: Scope.cloneDeep(f.scope),
    func: f.func,
    loop: f.loop
      ? {
          kind: f.loop.kind,
          cond: f.loop.cond,
          varName: f.loop.varName,
          items: f.loop.items,
          parentScope: Scope.cloneDeep(f.loop.parentScope),
          iterations: f.loop.iterations,
        }
      : undefined,
  };
}

function sameCoord(a: ColumnCoordinate, b: ColumnCoordinate): boolean {
  return a.columnId === b.columnId && a.index === b.index;
}

/**
 * 循环帧状态：while 每轮重判条件；for/foreach 物化数组逐元素推进
 * （老引擎 foreach 编译为 ForStmt 同构：len(expr) + expr[idx] 运行时求值）。
 */
interface LoopState {
  kind: "while" | "iterate";
  /** while：条件表达式原文（每轮执行期重判，04 §二.1） */
  cond?: unknown;
  /** iterate：循环变量名与物化元素序列 */
  varName?: string;
  items?: ExprValue[];
  /** 循环体外层作用域：每轮重建块作用域（S1） */
  parentScope: Scope;
  iterations: number;
}

/**
 * 执行帧：列帧（columnId 非空，作用域 = 列级）与块帧（columnId 空，作用域 = 块级）。
 * 嵌套块不进坐标——坐标恒指列内顶层位置（01 §一.4），块内进度由帧栈承载，
 * 快照时帧栈随状态一并保存即可满足 03 的确定性重放。
 */
interface Frame {
  columnId: string | null;
  commands: readonly StoryCommand[];
  index: number;
  scope: Scope;
  /** 循环帧标记（break/continue 回溯锚点） */
  loop?: LoopState;
  /** 函数帧标记（return 回溯锚点；break/continue 不得跨函数边界） */
  func?: true;
}

export class StoryEngine {
  private readonly story: Story;
  /** 02 §一.1 SSOT：系统键 + 全局用户键（块/列级变量在 Scope 树，不进此 Map——S3）；值写时复制 → 快照浅拷贝安全 */
  private state = new Map<string, unknown>();
  private coord: ColumnCoordinate = { columnId: "", index: 0 };
  private frames: Frame[] = [];
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private started = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private waitSkipable = false;
  /** 04 §一.7 函数注册表（func 执行期注册，call 按名查表；随快照恢复） */
  private functions = new Map<
    string,
    { params: string[]; body: StoryCommand[] }
  >();
  private inputStore: string | null = null;
  // —— 03 回溯与历史 ——
  private readonly historyLimit: number;
  private history: Checkpoint[] = [];
  /** 光标 = 当前时间线上最后归档的检查点（回溯后落后于 length-1；rollforward 用） */
  private cursor = -1;
  /** 03-R5 live 消歧：当前 live 画面是否已入档（menu/wait/input 展示中=true；say 上屏=false） */
  private liveCheckpointed = false;
  /** 03-R4 重放期标记（__rollback_active 键镜像） */
  private rollbackActive = false;
  /** say 上屏时捕获的待提交检查点（R1：等待解除后才入档） */
  private pendingSay: Checkpoint | null = null;
  /** 03-R6 确定性随机状态（mulberry32），进快照 */
  private rngState: number;

  constructor(story: Story, options?: EngineOptions) {
    this.story = story;
    this.historyLimit = options?.historyLimit ?? 200;
    this.rngState = (options?.rngSeed ?? Date.now()) | 0;
  }

  // —— 观察接缝 ——

  /** 02-E1：ValueChanged 是唯一观察接缝；所有状态写入都经 set 系方法镜像到这里 */
  onStateChanged(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** 02 §三.1 出站事件信封：engine.error / notify 等 */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** 帧循环直读（02 §六.2：帧级键由 UI 每帧直读，不进事件流） */
  get(key: string): unknown {
    return this.state.get(key);
  }

  // —— 会话命令面（02 §三.2 最小子集：start / advance / choose） ——

  /** story.start：导航至入口列（01 §一.7，project.json entry） */
  start(): void {
    if (this.started) {
      this.fail("already-started", "故事已启动，重复 start 无效");
      return;
    }
    this.started = true;
    // 01 §一.6：顶层 defines 无条件 Set（全局层 = SSOT Map）
    for (const [key, value] of Object.entries(this.story.defines ?? {})) {
      this.setGlobal(key, value);
    }
    if (!this.enterColumn(this.story.entry)) return;
    this.run();
  }

  /**
   * 02 §三.3：advance = `__dialog_complete = true`——对话推进唯一入口（E5）。
   * wait 等待的「用户点击解除」（02 §二.2：skipable 时）复用本命令，命令面保持最小。
   */
  advance(): void {
    if (!this.started) {
      this.fail("advance-invalid", "故事尚未启动");
      return;
    }
    const waiting = this.get(SYS.waiting);
    if (waiting === "dialog") {
      this.setSystem(SYS.dialogComplete, true);
      // 02 §二.3：离开等待后清 clickable/noskip，防状态泄漏到后续非 say 命令
      this.setSystem(SYS.dialogClickable, false);
      this.setSystem(SYS.dialogNoskip, false);
      this.setSystem(SYS.waiting, "none");
      // 03-R1：say 的检查点在等待解除后提交（快照已在上屏时捕获 = 玩家所见画面）
      if (this.pendingSay !== null && !this.rollbackActive) {
        this.commitCheckpoint(this.pendingSay);
      }
      this.pendingSay = null;
      this.liveCheckpointed = false; // live 已越过检查点（后续等待点在 run 中自行改写）
      this.run();
      return;
    }
    if (waiting === "wait") {
      if (!this.waitSkipable) {
        this.fail(
          "advance-invalid",
          "当前 wait 不可跳过（02 §二.2：仅 skipable 的 wait 可点击解除）",
        );
        return;
      }
      this.clearTimer();
      this.waitSkipable = false;
      this.setSystem(SYS.waiting, "none");
      this.liveCheckpointed = false; // live 已越过该检查点
      this.run();
      return;
    }
    this.fail(
      "advance-invalid",
      `advance 仅在对话等待中有效（当前 __waiting=${String(waiting)}）`,
    );
  }

  /** 02 §三.3：choose = 解析 menu_targets 得序号 → `__menu_selected = idx`（E6 fail-closed） */
  choose(optionId: string): void {
    if (!this.started || this.get(SYS.waiting) !== "menu") {
      this.fail(
        "choose-invalid",
        `choose 仅在菜单等待中有效（当前 __waiting=${String(this.get(SYS.waiting))}）`,
      );
      return;
    }
    const targets = this.get(SYS.menuTargets);
    if (!Array.isArray(targets)) {
      this.fail("menu-state-corrupt", "__menu_targets 缺失或非数组");
      return;
    }
    const idx = targets.indexOf(optionId);
    if (idx < 0) {
      this.fail(
        "choice-unknown-target",
        `未知选项目标：${optionId}（E6 fail-closed）`,
      );
      return;
    }
    this.setSystem(SYS.menuSelected, idx);
    this.setSystem(SYS.waiting, "none");
    this.liveCheckpointed = false; // 选择改变画面：live 未入档（03-R5，回退将落回菜单重选）
    // 01 §一.2：menu 选项目标 = columnId——选择即跳转（columnId 换、index 归零）
    if (!this.enterColumn(targets[idx] as string)) return;
    this.run();
  }

  /** 释放挂起定时器（UI 卸载/测试收尾）；监听器退订走 onXxx 返回的函数 */
  dispose(): void {
    this.clearTimer();
    this.waitSkipable = false;
  }

  // —— 内部实现 ——

  private clearTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private setSystem(key: string, value: unknown): void {
    this.state.set(key, value);
    this.emit(key, value, "system");
  }

  private setGlobal(key: string, value: unknown): void {
    this.state.set(key, value);
    this.emit(key, value, "global");
  }

  private emit(key: string, value: unknown, scope: string): void {
    const change: ValueChanged = { key, value, scope };
    for (const listener of this.stateListeners) listener(change);
  }

  /** E3：engine.error 事件出站，绝不静默 */
  private fail(code: string, message: string): void {
    const payload: OutboundPayload = {
      kind: "engine.error",
      code,
      message,
      coordinate: { ...this.coord },
    };
    const event: OutboundEvent = { v: 1, kind: "event", payload };
    for (const listener of this.eventListeners) listener(event);
  }

  private columnById(id: string): StoryColumn | undefined {
    return this.story.columns.find((c) => c.id === id);
  }

  /** 进入列：替换整个帧栈（出块/出列销毁作用域，S1），建列级作用域，坐标归零（01 §一.4） */
  private enterColumn(columnId: string): boolean {
    const column = this.columnById(columnId);
    if (column === undefined) {
      this.fail(
        "unknown-column",
        `目标列不存在：${columnId}（F1：跳转目标必须存在）`,
      );
      return false;
    }
    this.coord = { columnId, index: 0 };
    this.frames = [
      {
        columnId,
        commands:
          column.kind === "flow"
            ? column.commands!
            : [...(column.elements ?? []), ...(column.entry ?? [])],
        index: 0,
        scope: Scope.root(), // 列级作用域
      },
    ];
    this.setSystem(SYS.currentSceneColumn, columnId);
    return true;
  }

  /** 02 §二.1 逐命令解释执行：取命令 → 执行 → 前进；遇等待点即停（调用方保证 __waiting=none） */
  private run(): void {
    for (;;) {
      const frame = this.frames.at(-1);
      if (frame === undefined) return; // 全部帧结束 = 本故事段结束
      if (frame.index >= frame.commands.length) {
        const loop = frame.loop;
        if (loop !== undefined) {
          loop.iterations += 1;
          if (loop.kind === "while") {
            const again = this.evalCond(loop.cond);
            if (again === null) return; // 条件求值失败停机
            if (!again) {
              this.frames.pop();
              continue;
            }
            if (!this.beginLoopIteration(frame, loop)) return;
            continue;
          }
          // iterate：本轮完成 → 推进游标；序列耗尽 → 出循环
          if (loop.iterations >= loop.items!.length) {
            this.frames.pop();
            continue;
          }
          if (!this.beginLoopIteration(frame, loop)) return;
          continue;
        }
        this.frames.pop(); // 出块/出列：块级作用域随之不可达（S1）
        continue;
      }
      const cmd = frame.commands[frame.index]!;
      switch (cmd.op) {
        case "say":
          this.execSay(frame, cmd);
          return; // 进入对话等待，暂停循环
        case "menu":
          this.execMenu(frame, cmd);
          return; // 进入菜单等待
        case "wait":
          this.execWait(frame, cmd);
          return; // 进入定时等待
        case "pause":
          this.execWait(frame, cmd, true);
          return; // 进入硬等待
        case "jump":
          if (
            !this.enterColumn(typeof cmd.target === "string" ? cmd.target : "")
          )
            return;
          continue;
        case "if":
          if (!this.execIf(frame, cmd)) return;
          continue;
        case "while":
          if (!this.execWhile(frame, cmd)) return;
          continue;
        case "for":
          if (!this.execFor(frame, cmd)) return;
          continue;
        case "foreach":
          if (!this.execForeach(frame, cmd)) return;
          continue;
        case "switch":
          if (!this.execSwitch(frame, cmd)) return;
          continue;
        case "break":
        case "continue": {
          const depth = this.nearestLoopIndex();
          if (depth < 0) {
            this.fail(
              `${cmd.op}-outside-loop`,
              `${cmd.op} 必须在循环体内（while/for/foreach）`,
            );
            return;
          }
          if (cmd.op === "break") {
            this.frames.length = depth; // 弹出循环帧与其内部块帧（作用域随之销毁）
          } else {
            this.frames.length = depth + 1; // 保留循环帧，弹内部块帧
            const loopFrame = this.frames.at(-1)!;
            loopFrame.index = loopFrame.commands.length; // 走到帧耗尽分支 → 重判/推进
          }
          continue;
        }
        case "set":
        case "let":
        case "local":
          if (!this.execAssign(frame, cmd, cmd.op)) return;
          frame.index += 1;
          continue;
        case "define":
          if (!this.execDefine(cmd)) return;
          frame.index += 1;
          continue;
        case "undef":
          if (!this.execUndef(frame, cmd)) return;
          frame.index += 1;
          continue;
        case "func":
          if (!this.execFunc(cmd)) return;
          frame.index += 1;
          continue;
        case "call":
          if (!this.execCall(frame, cmd)) return;
          continue;
        case "return":
          if (!this.execReturn()) return;
          continue;
        case "input":
          this.execInput(frame, cmd);
          return; // 进入输入等待
        case "array":
          if (!this.execArray(cmd)) return;
          frame.index += 1;
          continue;
        case "array_push":
          if (!this.execArrayPush(cmd)) return;
          frame.index += 1;
          continue;
        case "array_pop":
          if (!this.execArrayPop(cmd)) return;
          frame.index += 1;
          continue;
        case "dict":
          if (!this.execDict(cmd)) return;
          frame.index += 1;
          continue;
        case "dict_set":
          if (!this.execDictSet(cmd)) return;
          frame.index += 1;
          continue;
        case "notify":
          this.execNotify(cmd);
          frame.index += 1;
          continue;
        case "random":
          if (!this.execRandom(cmd)) return;
          frame.index += 1;
          continue;
        default:
          // E3 fail-closed：未知/未实现 op 不静默跳过
          this.fail("unknown-op", `未知或未实现的命令：${cmd.op}`);
          return;
      }
    }
  }

  /** say：写对话系统键 → 进入 dialog 等待（02 §二.2/3；插值见 01 §三.4/S8/F7） */
  private execSay(frame: Frame, cmd: StoryCommand): void {
    if (typeof cmd.text !== "string" || cmd.text === "") {
      this.fail("say-invalid", "say 负载必须有非空 text 字符串");
      return;
    }
    const unknownFields = Object.keys(cmd).filter(
      (k) => !SAY_KNOWN_FIELDS.has(k),
    );
    if (unknownFields.length > 0) {
      this.fail(
        "say-unknown-field",
        `say 未知负载字段：${unknownFields.join(", ")}`,
      );
      return;
    }
    // 文本/说话人插值 + {var:00} 格式化（F7：仅文本命令）；行内标记 {b}{p} 原样透传；失败保留原文 + error（S8）
    // speaker 与 text 同语义插值——动态说话人（如 func 实参）经此获得真实名字
    const { text, errors } = interpolateText(
      cmd.text,
      this.resolveName,
      this.draw,
    );
    const speakerSrc = typeof cmd.speaker === "string" ? cmd.speaker : "";
    const { text: speakerText, errors: speakerErrors } = interpolateText(
      speakerSrc,
      this.resolveName,
      this.draw,
    );
    for (const e of [...errors, ...speakerErrors])
      this.fail(e.code, `插值失败（保留原文）：${e.message}`);

    // 02 §二.3 竞态防护：进入等待前清上一句残留的完成标记（防双击/快速点击跳句）
    this.setSystem(SYS.dialogComplete, false);
    this.setSystem(SYS.currentDialogSpeaker, speakerText);
    this.setSystem(SYS.currentDialogText, text);
    this.setSystem(SYS.dialogClickable, cmd.clickable === true);
    this.setSystem(SYS.dialogNoskip, cmd.noskip === true);
    this.setSystem(SYS.waiting, "dialog");
    // 重放落点（rollbackActive）即检查点 k 本体：live 视为已入档——back() 才能继续向前回退
    this.liveCheckpointed = this.rollbackActive;
    // 03-R1：快照在上屏时刻捕获（= 玩家所见画面，帧栈定位在本等待命令上），等待解除后才提交入档。
    // 重放期同样捕获：同坐标提交由 commitCheckpoint 原位替换（幂等），历史在回溯/读档路径上自愈完整
    this.pendingSay = this.takeSnapshot(this.checkpointCoord(frame));
    // 坐标推进：say 进入等待即前移，坐标恒指「下一待执行命令」——与 03-R1「检查点在用户所见之后」对齐
    frame.index += 1;
  }

  /**
   * 03 §一/01 §一.4：检查点/存档坐标恒指「能重放重建本等待点」的列内顶层位置。
   * - 列帧等待点：index 尚未前移 → 即等待命令本身（读档/重放重新执行它）
   * - 块帧（if/while/func 体）等待点：所在列帧 index 已指向块进入命令的下一命令 → 回退一格 = 重入命令
   */
  private checkpointCoord(waitingFrame: Frame): ColumnCoordinate {
    if (waitingFrame.columnId !== null) {
      return { columnId: waitingFrame.columnId, index: waitingFrame.index };
    }
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      const f = this.frames[i]!;
      if (f.columnId !== null) {
        return { columnId: f.columnId, index: Math.max(0, f.index - 1) };
      }
    }
    return { ...this.coord };
  }

  /** menu：写菜单系统键 → 进入 menu 等待（02 §二.2；清对话残留 08 §二.6） */
  private execMenu(frame: Frame, cmd: StoryCommand): void {
    const options = cmd.options as Array<{ text: string; target: string }>; // 解析器已验证结构
    this.setSystem(SYS.currentDialogText, "");
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(
      SYS.menuPrompt,
      typeof cmd.prompt === "string" ? cmd.prompt : "",
    );
    this.setSystem(
      SYS.menuOptions,
      options.map((o) => o.text),
    );
    this.setSystem(
      SYS.menuTargets,
      options.map((o) => o.target),
    );
    this.setSystem(SYS.menuSelected, -1);
    this.setSystem(SYS.waiting, "menu");
    // 03 §三：菜单展示时建检查点（展示中 live == 检查点，回退落回菜单重选）；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    frame.index += 1;
  }

  /** wait/pause（01 §二.1：wait 可 skipable、pause=hard；老规范 §6.4 seconds 必填） */
  private execWait(frame: Frame, cmd: StoryCommand, hard = false): void {
    const fields = hard ? PAUSE_FIELDS : WAIT_FIELDS;
    const unknownFields = Object.keys(cmd).filter((k) => !fields.has(k));
    if (unknownFields.length > 0) {
      this.fail(
        `${cmd.op}-unknown-field`,
        `${cmd.op} 未知负载字段：${unknownFields.join(", ")}`,
      );
      return;
    }
    this.waitSkipable = !hard && cmd.skipable === true;
    this.setSystem(SYS.waiting, "wait");
    // 03 §三：wait 检查点在等待建立时；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    frame.index += 1;
    this.pendingTimer = setTimeout(
      () => {
        this.pendingTimer = null;
        this.waitSkipable = false;
        if (this.get(SYS.waiting) !== "wait") return; // dispose 等场景防御
        this.setSystem(SYS.waiting, "none");
        this.liveCheckpointed = false; // live 已越过该检查点
        this.run();
      },
      Math.max(0, (cmd.seconds as number) * 1000),
    );
  }

  /** if/elif/else：条件执行期求值（04 §二.1）；分支体 = 块帧 + 块级作用域（04 §一.1） */
  private execIf(frame: Frame, cmd: StoryCommand): boolean {
    const cond = this.evalCond(cmd.cond);
    if (cond === null) return false;
    let branch: readonly StoryCommand[] | undefined = cond
      ? (cmd.then as readonly StoryCommand[])
      : undefined;
    if (branch === undefined && Array.isArray(cmd.elif)) {
      for (const elif of cmd.elif as Array<{
        cond: unknown;
        then: StoryCommand[];
      }>) {
        const c = this.evalCond(elif.cond);
        if (c === null) return false;
        if (c) {
          branch = elif.then;
          break;
        }
      }
    }
    if (branch === undefined && Array.isArray(cmd.else))
      branch = cmd.else as StoryCommand[];
    frame.index += 1;
    if (branch === undefined || branch.length === 0) return true;
    this.frames.push({
      columnId: null,
      commands: branch,
      index: 0,
      scope: frame.scope.enterChild(), // 块级作用域：出块销毁（S1）
    });
    return true;
  }

  /** while：条件执行期求值；body = 循环帧（每轮重判条件，04 §二.1） */
  private execWhile(frame: Frame, cmd: StoryCommand): boolean {
    const cond = this.evalCond(cmd.cond);
    if (cond === null) return false;
    frame.index += 1;
    if (!cond) return true;
    const loop: LoopState = {
      kind: "while",
      cond: cmd.cond,
      parentScope: frame.scope,
      iterations: 0,
    };
    this.frames.push({
      columnId: null,
      commands: cmd.body as readonly StoryCommand[],
      index: 0,
      scope: frame.scope,
      loop,
    });
    return this.beginLoopIteration(this.frames.at(-1)!, loop);
  }

  /** for（老规范 §6.1）：`in` 表达式执行期求值 → 必须为数组，逐元素迭代 */
  private execFor(frame: Frame, cmd: StoryCommand): boolean {
    try {
      const src = typeof cmd.in === "string" ? cmd.in.trim() : "";
      const inner =
        src.startsWith("{") && src.endsWith("}") ? src.slice(1, -1) : src;
      const value = evaluateExpression(inner, this.resolveName, () =>
        this.draw(),
      );
      if (!Array.isArray(value)) {
        this.fail("type-error", "for 的 in 表达式必须为数组");
        return false;
      }
      return this.pushIterateLoop(frame, cmd, value as ExprValue[]);
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  /** foreach（老规范 §6.1）：key 为集合变量名（foreach "v" in "k"，编译为 for 同构） */
  private execForeach(frame: Frame, cmd: StoryCommand): boolean {
    try {
      const key = cmd.key as string;
      const hit = this.resolveName(key);
      if (!hit.found || !Array.isArray(hit.value)) {
        this.fail("type-error", `foreach 集合 ${key} 不存在或不是数组`);
        return false;
      }
      return this.pushIterateLoop(frame, cmd, hit.value as ExprValue[]);
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  /** for/foreach 同构：物化数组 → 循环帧逐元素推进；循环变量 = 块级局部（S1） */
  private pushIterateLoop(
    frame: Frame,
    cmd: StoryCommand,
    items: ExprValue[],
  ): boolean {
    frame.index += 1;
    if (items.length === 0) return true;
    const loop: LoopState = {
      kind: "iterate",
      varName: cmd.var as string,
      items,
      parentScope: frame.scope,
      iterations: 0,
    };
    this.frames.push({
      columnId: null,
      commands: cmd.body as readonly StoryCommand[],
      index: 0,
      scope: frame.scope,
      loop,
    });
    return this.beginLoopIteration(this.frames.at(-1)!, loop);
  }

  /** 开始一轮迭代：每轮新块作用域（S1），声明循环变量，游标归零；超上限 fail-closed */
  private beginLoopIteration(frame: Frame, loop: LoopState): boolean {
    if (loop.iterations >= LOOP_LIMIT) {
      this.fail(
        "loop-limit",
        `循环迭代超过 ${LOOP_LIMIT} 次上限，已中断（防死循环安全网）`,
      );
      return false;
    }
    frame.scope = loop.parentScope.enterChild();
    if (loop.kind === "iterate") {
      frame.scope.declare(loop.varName!, loop.items![loop.iterations]!);
    }
    frame.index = 0;
    return true;
  }

  private nearestLoopIndex(): number {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      if (this.frames[i]!.func === true) return -1; // 函数边界：循环不得跨函数
      if (this.frames[i]!.loop !== undefined) return i;
    }
    return -1;
  }

  /** switch（老规范 §6.1：编译为 if/else 链——case 字面量相等比较，命中即走、不穿透） */
  private execSwitch(frame: Frame, cmd: StoryCommand): boolean {
    try {
      const src = typeof cmd.on === "string" ? cmd.on.trim() : "";
      const inner =
        src.startsWith("{") && src.endsWith("}") ? src.slice(1, -1) : src;
      const value = evaluateExpression(inner, this.resolveName, () =>
        this.draw(),
      );
      let body: readonly StoryCommand[] | undefined;
      for (const c of cmd.cases as Array<{
        value: unknown;
        body: StoryCommand[];
      }>) {
        if (exprEquals(value, c.value as ExprValue)) {
          body = c.body;
          break;
        }
      }
      if (body === undefined && Array.isArray(cmd.default)) {
        body = cmd.default as StoryCommand[];
      }
      frame.index += 1;
      if (body === undefined || body.length === 0) return true;
      this.frames.push({
        columnId: null,
        commands: body,
        index: 0,
        scope: frame.scope.enterChild(),
      });
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  /** 条件求值：{...} 包裹按约定剥离；结果必须 boolean；任何失败 → engine.error + 停机（S5） */
  private evalCond(src: unknown): boolean | null {
    if (typeof src !== "string") {
      this.fail("eval-type-error", "条件必须为字符串表达式");
      return null;
    }
    const t = src.trim();
    const inner = t.startsWith("{") && t.endsWith("}") ? t.slice(1, -1) : t;
    try {
      const v = evaluateExpression(inner, this.resolveName, () => this.draw());
      if (typeof v !== "boolean") {
        this.fail("eval-type-error", `条件必须为 boolean，收到 ${typeof v}`);
        return null;
      }
      return v;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return null;
      }
      throw e;
    }
  }

  /**
   * set/let/local（老规范 §6.2）：
   * - set：写入声明时所在层（04 §一.4），未声明 → 全局（SSOT Map）；支持 += 等复合赋值
   * - let/local：块级可变，声明进当前最内层作用域（04 §一.5）
   */
  private execAssign(frame: Frame, cmd: StoryCommand, op: string): boolean {
    const key = cmd.key as string;
    try {
      const compound =
        op === "set" && typeof cmd.value === "string"
          ? COMPOUND_PREFIX.exec(cmd.value)
          : null;
      let value: ExprValue;
      if (compound) {
        const sym = compound[1]!;
        const rhs = this.evalValue(compound[2]);
        const current = this.readVariable(key);
        if (typeof current !== "number" || typeof rhs !== "number") {
          throw new ExpressionError(
            "type-error",
            `复合赋值 ${sym} 只支持 number`,
          );
        }
        value = this.applyCompound(sym, current, rhs);
      } else {
        value = this.evalValue(cmd.value);
      }
      if (op === "set") {
        const scope = this.frames.at(-1)?.scope;
        // 装载顺序声明层优先；未声明落全局（SSOT Map）
        if (scope !== undefined && scope.assignExisting(key, value)) {
          this.emit(key, value, frame.columnId === null ? "block" : "column");
        } else {
          this.setGlobal(key, value);
        }
      } else {
        frame.scope.declare(key, value);
        this.emit(key, value, frame.columnId === null ? "block" : "column");
      }
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  private applyCompound(sym: string, current: number, rhs: number): number {
    switch (sym) {
      case "+=":
        return current + rhs;
      case "-=":
        return current - rhs;
      case "*=":
        return current * rhs;
      case "/=":
        if (rhs === 0)
          throw new ExpressionError("division-by-zero", "'/=' 除数为 0（S5）");
        return current / rhs;
      default:
        if (rhs === 0)
          throw new ExpressionError("division-by-zero", "'%=' 除数为 0（S5）");
        return current % rhs;
    }
  }

  /** define：全局 + once——不存在才设（04 §一.5 / F2 两语义之一） */
  private execDefine(cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    try {
      const value = this.evalValue(cmd.value);
      if (!this.state.has(key)) this.setGlobal(key, value);
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  /** undef：销毁声明槽（04 §一.5）；沿块/列作用域链与全局层查找 */
  private execUndef(frame: Frame, cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    const inScope = frame.scope.undef(key);
    const inGlobal = this.state.delete(key);
    if (!inScope && !inGlobal) {
      this.fail("unknown-variable", `undef：未定义变量 ${key}`);
      return false;
    }
    this.emit(key, undefined, frame.columnId === null ? "block" : "column");
    return true;
  }

  /** array（老规范 §6.2）：key + items[]（项可为 {expr}）；once → 已存在跳过 */
  private execArray(cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    try {
      if (cmd.once === true && this.state.has(key)) return true;
      const items = (cmd.items as unknown[]).map((item) =>
        this.evalValue(item),
      );
      this.setGlobal(key, items);
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  private execArrayPush(cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    try {
      const arr = this.state.get(key);
      if (!Array.isArray(arr)) {
        this.fail("type-error", `array_push 目标 ${key} 不存在或不是数组`);
        return false;
      }
      const value = this.evalValue(cmd.value);
      this.setGlobal(key, [...arr, value]); // 新数组引用，观察者可感知
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  private execArrayPop(cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    const arr = this.state.get(key);
    if (!Array.isArray(arr) || arr.length === 0) {
      this.fail("type-error", `array_pop 目标 ${key} 不存在、非数组或已空`);
      return false;
    }
    this.setGlobal(key, arr.slice(0, -1));
    return true;
  }

  /** dict（老规范 §6.2）：value 为 JSON 对象字面量（字段值可为 {expr}）；once 同 array */
  private execDict(cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    try {
      if (cmd.once === true && this.state.has(key)) return true;
      const value: Record<string, ExprValue> = {};
      for (const [field, v] of Object.entries(
        cmd.value as Record<string, unknown>,
      )) {
        value[field] = this.evalValue(v);
      }
      this.setGlobal(key, value);
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  private execDictSet(cmd: StoryCommand): boolean {
    const key = cmd.key as string;
    try {
      const dict = this.state.get(key);
      if (dict === null || typeof dict !== "object" || Array.isArray(dict)) {
        this.fail("type-error", `dict_set 目标 ${key} 不存在或不是字典`);
        return false;
      }
      const value = this.evalValue(cmd.value);
      this.setGlobal(key, {
        ...(dict as Record<string, ExprValue>),
        [cmd.field as string]: value,
      });
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  /** notify：出站 toast 事件（01 §二.1 → 08 §二.4 覆盖层）；文本插值与 say 同语义 */
  private execNotify(cmd: StoryCommand): void {
    const { text, errors } = interpolateText(
      cmd.text as string,
      this.resolveName,
      this.draw,
    );
    for (const e of errors)
      this.fail(e.code, `插值失败（保留原文）：${e.message}`);
    const payload: OutboundPayload = {
      kind: "notify",
      text,
      ...(typeof cmd.type === "string" ? { notifyType: cmd.type } : {}),
      ...(typeof cmd.duration === "number" ? { duration: cmd.duration } : {}),
    };
    const event: OutboundEvent = { v: 1, kind: "event", payload };
    for (const listener of this.eventListeners) listener(event);
  }

  /** func（04 §一.7 / 老规范 §6.2）：执行期注册进函数表；重复注册 fail-closed（确定性重放重入同函数 = 幂等放行） */
  private execFunc(cmd: StoryCommand): boolean {
    const name = cmd.name as string;
    const registered = this.functions.get(name);
    const next = {
      params: cmd.params as string[],
      body: cmd.body as StoryCommand[],
    };
    if (registered !== undefined) {
      // 确定性重放（回溯/读档重入）携带同一故事体 → 引用相等即幂等放行；内容不同才是真重复
      const identical =
        registered.body === next.body &&
        registered.params.length === next.params.length &&
        registered.params.every((p, i) => p === next.params[i]);
      if (!identical && !this.rollbackActive) {
        this.fail("func-duplicate", `函数重复注册：${name}`);
        return false;
      }
    }
    this.functions.set(name, next);
    return true;
  }

  /**
   * call（04 §一.7）：按名查表 → 实参求值按位绑定 → 函数帧（体 = 独立块作用域）。
   * 未注册/参数个数不符 fail-closed。
   */
  private execCall(frame: Frame, cmd: StoryCommand): boolean {
    const name = cmd.target as string;
    const fn = this.functions.get(name);
    if (fn === undefined) {
      this.fail("call-unknown-function", `调用未注册的函数：${name}`);
      return false;
    }
    try {
      const args = ((cmd.args as unknown[] | undefined) ?? []).map((a) =>
        this.evalValue(a),
      );
      if (args.length !== fn.params.length) {
        this.fail(
          "arity-error",
          `函数 ${name} 需要 ${fn.params.length} 个参数，收到 ${args.length}`,
        );
        return false;
      }
      frame.index += 1;
      const scope = frame.scope.enterChild(); // 函数体内作用域 = 独立块
      fn.params.forEach((p, i) => scope.declare(p, args[i]!));
      this.frames.push({
        columnId: null,
        commands: fn.body,
        index: 0,
        scope,
        func: true,
      });
      return true;
    } catch (e) {
      if (e instanceof ExpressionError) {
        this.fail(e.code, e.message);
        return false;
      }
      throw e;
    }
  }

  /** return（04 §一.7）：弹出函数帧及其内部块帧，回到调用方；函数外 return fail-closed */
  private execReturn(): boolean {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      if (this.frames[i]!.func === true) {
        this.frames.length = i; // 移除函数帧及其内部剩余帧
        return true;
      }
    }
    this.fail("return-outside-func", "return 必须在 func 体内");
    return false;
  }

  /** input（老规范 §6.1：prompt + store）→ 进入 input 等待；options 选项式输入延后（解析层拒绝） */
  private execInput(frame: Frame, cmd: StoryCommand): void {
    // 输入态清对话残留（与 menu 同语义，08 §二.6）
    this.setSystem(SYS.currentDialogText, "");
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(
      SYS.inputPrompt,
      typeof cmd.prompt === "string" ? cmd.prompt : "",
    );
    this.inputStore = cmd.store as string;
    this.setSystem(SYS.waiting, "input");
    // 03 §三：input 检查点在等待建立时；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    frame.index += 1;
  }

  /** 02 §三.2 命令面 input(text)：输入等待的唯一解除入口；store 未定义 fail-closed */
  input(value: string): void {
    if (!this.started || this.get(SYS.waiting) !== "input") {
      this.fail(
        "input-invalid",
        `input 仅在输入等待中有效（当前 __waiting=${String(this.get(SYS.waiting))}）`,
      );
      return;
    }
    const store = this.inputStore;
    if (store === null) {
      this.fail("input-state-corrupt", "输入等待缺少 store 目标");
      return;
    }
    this.inputStore = null;
    this.setGlobal(store, value);
    this.setSystem(SYS.waiting, "none");
    this.liveCheckpointed = false; // 提交改变画面：live 未入档（03-R5）
    this.run();
  }

  // —— 05 存档编排（TS 侧；加密/AAD/高水位安全在 Rust 层，K7） ——

  /** 当前 live 位置所在的列帧（块帧之下） */
  private columnFrame(): Frame | undefined {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      if (this.frames[i]!.columnId !== null) return this.frames[i];
    }
    return undefined;
  }

  /** 按坐标重建列帧（存档不进帧栈——S3：块/列级作用域不进档，读档后确定性重放重建） */
  private columnFrameAt(coord: ColumnCoordinate): Frame {
    const column = this.columnById(coord.columnId)!;
    return {
      columnId: coord.columnId,
      commands:
        column.kind === "flow"
          ? column.commands!
          : [...(column.elements ?? []), ...(column.entry ?? [])],
      index: coord.index,
      scope: Scope.root(), // S3
    };
  }

  /**
   * 05 §四：导出存档载荷。必须在等待点调用（列尾/未启动 fail-closed 拒绝）。
   * 载荷 = 等待点坐标 + 全局状态 + rngState + 函数表 + 历史（R8）；不含块/列级作用域与帧栈（S3）。
   */
  exportSave(): SaveDataV1 | null {
    const waiting = this.get(SYS.waiting);
    const columnFrame = this.columnFrame();
    if (
      waiting === undefined ||
      waiting === "none" ||
      columnFrame === undefined ||
      columnFrame.columnId === null
    ) {
      this.fail("save-invalid", "当前不在等待点，无法存档");
      return null;
    }
    return {
      formatVersion: 1,
      storyId: this.story.id,
      coord: {
        columnId: columnFrame.columnId,
        index: Math.max(0, columnFrame.index - 1),
      },
      state: [...this.state.entries()],
      rngState: this.rngState,
      functions: [...this.functions.entries()],
      cursor: this.cursor,
      history: this.history.map((cp) => ({
        coord: { ...cp.coord },
        state: cp.snapshot.state,
        rngState: cp.snapshot.rngState,
      })),
    };
  }

  /**
   * 05 §四/03-R8：读档——恢复全局态与历史，从存档坐标重放重建等待点。
   * 帧栈按坐标重建列帧（S3）；故事版本不匹配 fail-closed（§四.6）。
   * 返回 false = 已拒绝（engine.error 事件已出站），调用方不得当作成功处理。
   */
  importSave(data: SaveDataV1): boolean {
    if (data?.formatVersion !== 1) {
      this.fail("save-format", "存档格式版本不支持");
      return false;
    }
    // §四.6 fail-closed：结构不完整或坐标失效（列定义已变更）= 存档与当前故事版本不匹配。
    // 全量预校验（含历史检查点坐标），任何不符都不得进入恢复流程（防 TypeError 式崩溃）。
    if (
      !Array.isArray(data.state) ||
      !Array.isArray(data.functions) ||
      !Array.isArray(data.history) ||
      typeof data.coord?.columnId !== "string" ||
      typeof data.coord.index !== "number" ||
      typeof data.rngState !== "number"
    ) {
      this.fail("save-format", "存档结构不完整");
      return false;
    }
    const coords: ColumnCoordinate[] = [
      data.coord,
      ...data.history.map((h) => h?.coord),
    ];
    for (const coord of coords) {
      if (
        typeof coord?.columnId !== "string" ||
        typeof coord?.index !== "number" ||
        this.columnById(coord.columnId) === undefined
      ) {
        this.fail(
          "save-story-mismatch",
          "该存档与当前故事版本不匹配（列定义已变更）",
        );
        return false;
      }
    }
    if (data.storyId !== this.story.id) {
      this.fail("save-story-mismatch", "该存档与当前故事不匹配");
      return false;
    }
    this.clearTimer();
    this.state = new Map(data.state);
    this.rngState = data.rngState;
    this.functions = new Map(data.functions);
    this.history = data.history.map((h) => ({
      coord: { ...h.coord },
      snapshot: {
        state: h.state,
        rngState: h.rngState,
        frames: [this.columnFrameAt(h.coord)],
        coord: { ...h.coord },
        functions: data.functions,
      },
    }));
    this.cursor = Math.min(Math.max(data.cursor, 0), this.history.length - 1);
    this.started = true;
    this.pendingSay = null;
    this.frames = [this.columnFrameAt(data.coord)];
    this.coord = { ...data.coord };
    this.liveCheckpointed = true;
    this.setSystem(SYS.waiting, "none");
    this.run(); // 确定性重放：从存档命令重建等待画面（同坐标提交由 commitCheckpoint 原位替换）
    return true;
  }

  // —— 03 回溯与历史 ——

  /** 快照捕获：状态 + rngState + 帧栈 + 函数表（Scope 深拷贝，回溯恢复后互不串扰） */
  private takeSnapshot(coord: ColumnCoordinate): Checkpoint {
    return {
      coord,
      snapshot: {
        state: [...this.state.entries()],
        rngState: this.rngState,
        frames: this.frames.map(cloneFrame),
        coord: { ...this.coord },
        functions: [...this.functions.entries()],
      },
    };
  }

  /** 恢复快照：写时复制不变量使 state 浅拷贝安全；waiting 归零后由重放重新建立等待 */
  private restore(cp: Checkpoint): void {
    this.state = new Map(cp.snapshot.state);
    this.rngState = cp.snapshot.rngState;
    this.frames = cp.snapshot.frames.map(cloneFrame);
    this.coord = { ...cp.snapshot.coord };
    this.functions = new Map(cp.snapshot.functions);
    this.pendingSay = null;
    // 回溯清挂起的 wait 定时器：重放若落在另一 wait 上，旧定时器不得提前双触发
    this.clearTimer();
    this.waitSkipable = false;
    this.liveCheckpointed = true; // 检查点 k 即当前 live 位置（重放中的等待点会自行改写）
    this.setSystem(SYS.waiting, "none");
  }

  /**
   * 提交检查点（03-R2 分岔裁定 + §三.3 容量淘汰）：
   * - 重取同坐标（回溯后重放推进）→ 原位替换，不动时间线
   * - 与前向时间线同坐标 → cursor 前移（rollforward 保留）
   * - 同列内介于 cursor 与下一检查点之间 → 新发现的中间站：插入（残缺历史自愈，用户实测回归）
   * - 其余坐标不同 → 截断旧前向（R2：重选 ≠ 旧选择 = 新时间线）
   */
  private commitCheckpoint(cp: Checkpoint): void {
    const current = this.history[this.cursor];
    if (current !== undefined && sameCoord(current.coord, cp.coord)) {
      this.history[this.cursor] = cp;
      return;
    }
    if (this.cursor < this.history.length - 1) {
      const next = this.history[this.cursor + 1]!;
      if (sameCoord(next.coord, cp.coord)) {
        this.cursor += 1;
        this.history[this.cursor] = cp;
        return;
      }
      const previous = this.history[this.cursor]!;
      const sameColumn =
        previous !== undefined &&
        cp.coord.columnId === previous.coord.columnId &&
        cp.coord.columnId === next.coord.columnId;
      const between =
        cp.coord.index > previous.coord.index &&
        cp.coord.index < next.coord.index;
      if (sameColumn && between) {
        // 残缺历史自愈：重放重入的中间等待点（如 input）插入时间线，前向保留
        this.history.splice(this.cursor + 1, 0, cp);
        this.cursor += 1;
        return;
      }
      this.history.length = this.cursor + 1; // R2：开辟新时间线，旧前向作废
    }
    if (
      this.history.length >= this.historyLimit &&
      this.cursor === this.history.length - 1
    ) {
      this.history.shift(); // §三.3 容量淘汰最旧（未回溯状态下安全）
    }
    this.history.push(cp);
    this.cursor = this.history.length - 1;
  }

  /**
   * 03-R1/R5 补交规则：离开当前画面（回退/跳转）前，把已上屏未入档的 say 检查点补交入档。
   * 玩家所见画面即有效历史——入档后 forward 才能回到「离开时的位置」（否则回退后前进无路）。
   */
  private flushPendingCheckpoint(): void {
    if (this.pendingSay !== null) {
      this.commitCheckpoint(this.pendingSay);
      this.pendingSay = null;
      this.liveCheckpointed = true;
    }
  }

  /**
   * 03 §一 回溯三步：找目标检查点 → 恢复快照 → 重放到该等待点。
   * target = 检查点下标或坐标（取坐标之前最近的检查点）。
   */
  rollbackTo(target: number | ColumnCoordinate): void {
    if (!this.started) {
      this.fail("rollback-invalid", "故事尚未启动");
      return;
    }
    if (this.rollbackActive) {
      this.fail("rollback-in-progress", "回放进行中，拒绝重入");
      return;
    }
    this.flushPendingCheckpoint(); // 离开当前画面：所见即入档（forward 可回到离开位置）
    let index: number;
    if (typeof target === "number") {
      index = target;
    } else {
      index = -1;
      for (let i = 0; i <= this.cursor; i += 1) {
        const c = this.history[i]!;
        if (
          c.coord.columnId === target.columnId &&
          c.coord.index <= target.index
        )
          index = i;
      }
      if (index < 0) {
        this.fail(
          "rollback-target-not-found",
          `坐标之前没有检查点：(${target.columnId}, ${target.index})`,
        );
        return;
      }
    }
    if (index < 0 || index >= this.history.length) {
      this.fail(
        "rollback-target-out-of-range",
        `检查点下标越界：${index}（共 ${this.history.length}）`,
      );
      return;
    }
    this.restore(this.history[index]!);
    this.cursor = index;
    // 03-R4：重放期输入锁 + 完成后解除并广播
    this.rollbackActive = true;
    this.setSystem(SYS.rollbackActive, true);
    this.run(); // 同步重放至等待点（R3：menu 真实等待）
    this.rollbackActive = false;
    this.setSystem(SYS.rollbackActive, false);
    // 03-R5：重放落点即检查点 k 的等待点——live 视为已入档，back() 才能继续向前回退
    this.liveCheckpointed = true;
    const event: OutboundEvent = {
      v: 1,
      kind: "event",
      payload: { kind: "rollback.done", coordinate: { ...this.coord } },
    };
    for (const listener of this.eventListeners) listener(event);
  }

  /** 03 §四.4 滚轮上：回退一步。live 已入档 → 退到前一个；未入档（如菜单选择后）→ 落回当前检查点（重选菜单，R5） */
  back(): void {
    if (!this.started || this.rollbackActive) {
      this.fail("rollback-invalid", "当前不可回退");
      return;
    }
    this.flushPendingCheckpoint(); // 离开当前画面：所见即入档（forward 可回到离开位置）
    const target = this.liveCheckpointed ? this.cursor - 1 : this.cursor;
    if (target < 0) {
      this.fail("history-empty", "已回溯到最早保留点");
      return;
    }
    this.rollbackTo(target);
  }

  /** 03 §四.4 滚轮下：沿未截断时间线 rollforward（R2 分岔后旧前向已截断） */
  forward(): void {
    if (!this.started || this.rollbackActive) {
      this.fail("rollback-invalid", "当前不可前进");
      return;
    }
    if (this.cursor >= this.history.length - 1) {
      this.fail("no-forward", "没有可前进的历史（已在最新处或时间线已分岔）");
      return;
    }
    this.rollbackTo(this.cursor + 1);
  }

  /** 03 §四 历史面板数据（前端职责的可视化皮）：对话类检查点带说话者与文本 */
  historyView(): Array<{
    index: number;
    coord: ColumnCoordinate;
    speaker: string;
    text: string;
  }> {
    return this.history.map((cp, index) => ({
      index,
      coord: { ...cp.coord },
      speaker:
        typeof cp.snapshot.state.find(
          ([k]) => k === SYS.currentDialogSpeaker,
        )?.[1] === "string"
          ? (cp.snapshot.state.find(
              ([k]) => k === SYS.currentDialogSpeaker,
            )?.[1] as string)
          : "",
      text:
        typeof cp.snapshot.state.find(
          ([k]) => k === SYS.currentDialogText,
        )?.[1] === "string"
          ? (cp.snapshot.state.find(
              ([k]) => k === SYS.currentDialogText,
            )?.[1] as string)
          : "",
    }));
  }

  /** 03-R6 mulberry32 确定性随机 [0,1)：rngState 进快照，回溯重放序列必然一致 */
  private draw(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private drawInt(min: number, max: number): number {
    return min + Math.floor(this.draw() * (max - min + 1)); // 含端点
  }

  /** 01 §二.6 random op（03-R6 显式种子）：重置 rngState 为种子 → 抽值 → 写入 var */
  private execRandom(cmd: StoryCommand): boolean {
    const seed = cmd.seed;
    const range = cmd.range;
    const key = cmd.var;
    if (typeof seed !== "number" || !Number.isInteger(seed)) {
      this.fail("type-error", "random 的 seed 必须为整数");
      return false;
    }
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      typeof range[0] !== "number" ||
      typeof range[1] !== "number"
    ) {
      this.fail("type-error", "random 的 range 必须为 [min, max] 数字数组");
      return false;
    }
    if (typeof key !== "string" || key === "") {
      this.fail("type-error", "random 的 var 必须为非空字符串");
      return false;
    }
    const min = range[0]!;
    const max = range[1]!;
    if (min > max) {
      this.fail("invalid-range", "random 下界必须 ≤ 上界");
      return false;
    }
    this.rngState = seed | 0;
    this.setGlobal(key, this.drawInt(min, max));
    return true;
  }

  /**
   * set/define 负载值（老规范 §七：表达式一律 {} 包裹，字符串原样即字面量）：
   * - "{expr}" → 表达式求值；number/boolean（JSON 原生）→ 字面量；其余字符串 → 字符串字面量
   */
  private evalValue(raw: unknown): ExprValue {
    if (typeof raw === "number" || typeof raw === "boolean") return raw;
    if (typeof raw !== "string") {
      throw new ExpressionError("type-error", `不支持的值类型：${typeof raw}`);
    }
    const t = raw.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      return evaluateExpression(t.slice(1, -1), this.resolveName, () =>
        this.draw(),
      );
    }
    return raw;
  }

  private readVariable(key: string): ExprValue {
    const hit = this.resolveName(key);
    if (!hit.found)
      throw new ExpressionError("unknown-variable", `未定义变量：${key}`);
    return hit.value as ExprValue;
  }

  /**
   * 名称解析（04 §二.9，老 ResolveValue 语义照搬）：
   * 块/列作用域链 → 全局扁平键；点路径再走「扁平优先 → 字典逐层下钻」。
   */
  private resolveName = ((
    name: string,
  ): { found: true; value: unknown } | { found: false } => {
    const scope = this.frames.at(-1)?.scope;
    if (scope !== undefined) {
      const hit = scope.lookup(name);
      if (hit.found) return hit;
    }
    if (this.state.has(name))
      return { found: true, value: this.state.get(name) };
    if (name.includes(".")) {
      const parts = name.split(".");
      let cur: unknown;
      if (scope !== undefined) {
        const head = scope.lookup(parts[0]!);
        if (head.found) cur = head.value;
      }
      if (cur === undefined) {
        if (!this.state.has(parts[0]!)) return { found: false };
        cur = this.state.get(parts[0]!);
      }
      for (const seg of parts.slice(1)) {
        if (cur === null || typeof cur !== "object" || Array.isArray(cur))
          return { found: false };
        const rec = cur as Record<string, unknown>;
        if (!(seg in rec)) return { found: false };
        cur = rec[seg];
      }
      return { found: true, value: cur };
    }
    return { found: false };
  }) satisfies NameResolver;
}

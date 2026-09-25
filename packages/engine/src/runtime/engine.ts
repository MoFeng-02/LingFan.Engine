/**
 * 02-执行模型：SSOT 状态容器 + 帧栈式逐命令解释执行 + advance/choose 命令面。
 * 04-作用域：块/列级 Scope 树 + 全局（SSOT Map）；块/列级不进存档（S3）。
 * 框架无关：只写状态与事件，渲染归 UI 层（08-U1）。
 */
import type {
  AudioChannelState,
  CharacterDef,
  ColumnCoordinate,
  EventListener,
  I18nOverlayFile,
  I18nPort,
  MinigameResult,
  OutboundEvent,
  OutboundPayload,
  SaveDataV1,
  SaveMode,
  SavePort,
  StateListener,
  Story,
  StoryColumn,
  StoryCommand,
  SaveOptions,
  ValueChanged,
  VideoCommand,
} from "../contracts";
import { SYS } from "../contracts";
import {
  ExpressionError,
  evaluateExpression,
  exprEquals,
  interpolateText,
  type ExprValue,
} from "./expr";
import { mergeOverlayFiles } from "./i18n";
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

/** 08 §六.1 音频 op 已知负载字段（未知字段 fail-closed，E3/F5） */
const AUDIO_FIELDS: Record<string, ReadonlySet<string>> = {
  bgm: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  se: new Set(["op", "resource", "volume"]),
  ambient: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  stop_bgm: new Set(["op", "fade"]),
  stop_ambient: new Set(["op", "fade"]),
  voice: new Set(["op", "resource", "volume", "auto_stop", "restart"]),
  stop_voice: new Set(["op", "fade"]),
};

/** 停止类 op → 目标常驻通道系统键 */
const AUDIO_STOP_KEY: Record<string, string> = {
  stop_bgm: SYS.audioBgm,
  stop_ambient: SYS.audioAmbient,
  stop_voice: SYS.audioVoice,
};

/** 音频通道 op → 常驻通道系统键（se 为一次性触发，不在表内） */
const AUDIO_CHANNEL_KEY: Record<string, string> = {
  bgm: SYS.audioBgm,
  ambient: SYS.audioAmbient,
  voice: SYS.audioVoice,
};

/** 08 §六.5 视频族已知负载字段（未知字段 fail-closed，E3/F5） */
const VIDEO_FIELDS: Record<string, ReadonlySet<string>> = {
  video: new Set(["op", "resource", "volume", "loop"]),
  cutscene: new Set(["op", "resource", "volume", "skipable"]),
  seek_video: new Set(["op", "seconds"]),
  pause_video: new Set(["op"]),
  resume_video: new Set(["op"]),
  stop_video: new Set(["op"]),
  video_skipable: new Set(["op", "value"]),
};

/** 06 §二.1 minigame 已知负载字段（未知字段 fail-closed，E3/F5） */
const MINIGAME_FIELDS = new Set([
  "op",
  "game",
  "config",
  "on_success",
  "on_fail",
  "reward",
]);

/** 01 §二.3 存档类 op 已知负载字段（未知字段 fail-closed，E3/F5；权威：JSON故事格式_V1 §6） */
const SAVE_FIELDS: Record<string, ReadonlySet<string>> = {
  save: new Set(["op", "slot", "title"]),
  load: new Set(["op", "slot"]),
  auto_save: new Set(["op", "enabled"]),
  save_delete: new Set(["op", "slot"]),
};

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
  /** 05 §五 存档编排端口（save/load/auto_save/save_delete op 与命令面 save/load 的依赖；缺省 = 存档类 op fail-closed） */
  savePort?: SavePort;
  /** 05 §五 存档模式（缺省 machine-bound；Rust 层同缺省） */
  saveMode?: SaveMode;
  /** 01 §四.3 I18N overlay 供给端口（setLanguage 按需加载译文；缺省 = 原文直出） */
  i18nPort?: I18nPort;
}

/** 05 槽位信任边界（与 Rust validate_slot 同判）：字母数字/_/-，1..64 */
function validSlot(slot: string): boolean {
  return slot.length > 0 && slot.length <= 64 && /^[A-Za-z0-9_-]+$/.test(slot);
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

/** 快照状态中的字符串键值（缺省/非字符串 = 空串） */
function snapshotText(cp: Checkpoint, key: string): string {
  const found = cp.snapshot.state.find(([k]) => k === key)?.[1];
  return typeof found === "string" ? found : "";
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
  private story: Story; // 热重载（07 §三.2）原子替换：private 字段非公共契约
  /** 02 §一.1 SSOT：系统键 + 全局用户键（块/列级变量在 Scope 树，不进此 Map——S3）；值写时复制 → 快照浅拷贝安全 */
  private state = new Map<string, unknown>();
  private coord: ColumnCoordinate = { columnId: "", index: 0 };
  private frames: Frame[] = [];
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private started = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private waitSkipable = false;
  /** 08-U4 角色定义注册表（character op 注册，say speaker 匹配自动套样式） */
  private readonly characters = new Map<string, CharacterDef>();
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
  /** 08 §六.1 se 触发序号：单调递增且不进快照——重放/读档后仍能区分「再次触发」 */
  private mediaSeq = 0;
  /** 08 §六.5 视频命令序号：单调递增且不进快照（渲染器按 seq 执行/去重） */
  private videoSeq = 0;
  /** 06 §二.1 小游戏挂载序号：单调递增且不进快照（重放重新挂载与旧挂载可分辨） */
  private minigameSeq = 0;
  /** 06 §二.1 挂起的小游戏等待：分流目标与已求值奖励（resolveMinigame 消费；中断即清除） */
  private pendingMinigame: {
    onSuccess?: string;
    onFail?: string;
    reward: { key: string; value: unknown }[];
  } | null = null;
  /** 06 §二.1 当前挂载的中断信号源：回溯/读档/导航/销毁时 abort（UI 据此卸载，D5） */
  private minigameController: AbortController | null = null;

  /** 05 §五 存档编排端口与模式（组合根注入；缺省 = 存档类 op/命令面 fail-closed） */
  private savePort: SavePort | undefined;
  private saveMode: SaveMode;
  /** 01 §二.3 save op 的一次性存档声明：载荷在下一玩家所见等待画面落档（05 §四 coord=等待点） */
  private pendingSave: { slot: string; title?: string } | null = null;
  /** 01 §四.3 I18N 端口与当前语言译文表（null = 原文直出；切换 = 整表重建，老引擎「清缓存」同语义） */
  private i18nPort: I18nPort | undefined;
  private overlay: Map<string, string> | null = null;

  constructor(story: Story, options?: EngineOptions) {
    this.story = story;
    this.historyLimit = options?.historyLimit ?? 200;
    this.rngState = (options?.rngSeed ?? Date.now()) | 0;
    this.savePort = options?.savePort;
    this.saveMode = options?.saveMode ?? "machine-bound";
    this.i18nPort = options?.i18nPort;
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
    // 08-U5：NVL 模式从 start 起恒有定义（静默初始化——事件流只承载离散变化，§六.2）
    this.state.set(SYS.nvlMode, "none");
    // 01 §四.3：当前语言从 start 起恒有定义（空串 = 默认语言/原文直出）
    this.state.set(SYS.currentLanguage, "");
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
      // 08 §六.1 voice auto_stop：玩家推进过该句 → 该句语音自动停止（互斥单槽）
      const voice = this.get(SYS.audioVoice) as
        AudioChannelState | null | undefined;
      if (voice?.kind === "play" && voice.autoStop === true) {
        this.setSystem(SYS.audioVoice, { kind: "stop", fadeMs: 0 });
      }
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
    if (waiting === "video") {
      // 08 §六.5：cutscene 可跳过（skipable）→ 停视频并解除等待；不可跳 fail-closed
      const video = this.get(SYS.video) as VideoCommand | null | undefined;
      if (!(video?.kind === "play" && video.skipable)) {
        this.fail(
          "advance-invalid",
          "当前过场不可跳过（cutscene skipable=false）",
        );
        return;
      }
      this.videoSeq += 1;
      this.setSystem(SYS.video, {
        kind: "stop",
        seq: this.videoSeq,
      } satisfies VideoCommand);
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

  /**
   * 02 §三.3 会话命令 navigate：坐标切换（columnId 校验 fail-closed）——
   * UI/元素 nav 按钮与热重载重入的接缝。纯切换不建检查点（与 op navigate 的
   * 叙事节点检查点相区分；老引擎 UI nav 走 NavigateHandler 不建 DSL 检查点，同语义）。
   */
  navigate(columnId: string): void {
    if (!this.started) {
      this.fail("navigate-invalid", "故事尚未启动");
      return;
    }
    this.flushPendingCheckpoint(); // 离开当前画面：已上屏未入档的 say 即所见（03-R1/R5）
    this.clearTimer(); // 打断任意等待（wait 定时器废弃，等待画面由新列重建）
    this.abortMinigame(); // 导航打断小游戏：abort 挂载信号（D5 等待期可回溯同语义）
    this.waitSkipable = false;
    this.liveCheckpointed = false;
    this.setSystem(SYS.waiting, "none");
    this.setSystem(SYS.currentDialogText, ""); // 清旧对话镜像（老引擎导航清屏语义）
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(SYS.dialogComplete, false);
    if (!this.enterColumn(columnId)) return;
    this.run();
  }

  /**
   * 02 §三.2 会话命令 save：编排写档（05 §五——载荷编排在 TS，安全在 Rust，K7）。
   * 非等待语义：kick 异步写档后立即返回；写档失败经 engine.error 可观测（不吞）。
   */
  save(slot: string, options?: SaveOptions): boolean {
    if (!this.started) {
      this.fail("save-invalid", "故事尚未启动");
      return false;
    }
    if (!validSlot(slot)) {
      this.fail(
        "save-invalid-slot",
        `槽位名非法：${slot}（字母数字/_/-，1..64）`,
      );
      return false;
    }
    if (this.savePort === undefined) {
      this.fail(
        "save-unavailable",
        "未装配 SavePort（组合根经 EngineOptions 注入）",
      );
      return false;
    }
    const data = this.exportSave();
    if (data === null) return false; // exportSave 已发 engine.error（不在等待点）
    const payload: SaveDataV1 = { ...data, ...options };
    void this.savePort
      .write(slot, JSON.stringify(payload), this.saveMode)
      .then(() => this.emitEvent({ kind: "save.done", slot })) // 完成信号：UI 据此提示
      .catch((e: unknown) => {
        this.fail("save-write-failed", `槽位 ${slot} 写档失败：${String(e)}`);
      });
    return true;
  }

  /**
   * 02 §三.2 会话命令 load：读档 → importSave（成功即传送到档内等待点；
   * 异步完成，失败 fail-closed 状态原样）。
   */
  load(slot: string): boolean {
    if (!this.started) {
      this.fail("load-invalid", "故事尚未启动");
      return false;
    }
    if (!validSlot(slot)) {
      this.fail("load-invalid-slot", `槽位名非法：${slot}`);
      return false;
    }
    if (this.savePort === undefined) {
      this.fail("load-unavailable", "未装配 SavePort");
      return false;
    }
    void this.savePort
      .read(slot)
      .then((raw) => {
        const data = JSON.parse(raw) as SaveDataV1;
        // 校验失败由 importSave 发 engine.error 并返回 false（此时不发完成信号）
        if (this.importSave(data)) this.emitEvent({ kind: "load.done", slot });
      })
      .catch((e: unknown) => {
        this.fail("load-failed", `槽位 ${slot} 读取或解析失败：${String(e)}`);
      });
    return true;
  }

  /**
   * 01 §四.3 setLanguage：切换当前语言（老引擎 SwitchLanguage 同语义——
   * 清缓存 + 写系统键，**当前画面不重放**，下次 Translate 生效）。空串 = 默认语言/原文直出。
   * 供给失败 fail-closed：保持原语言与译文表不变，engine.error 上报。
   * 可在 start 前调用（标题画面选语言）：状态键写入与译文装配不依赖启动态。
   */
  async setLanguage(lang: string): Promise<void> {
    if (typeof lang !== "string") {
      this.fail(
        "i18n-lang-invalid",
        "setLanguage 参数必须为字符串（空串 = 默认语言/原文直出）",
      );
      return;
    }
    if (lang === "" || this.i18nPort === undefined) {
      // 默认语言或未装配端口：无译文表 = 原文直出（01 §四.3 缺省；语言状态照记供 UI 观察）
      this.overlay = null;
      this.setSystem(SYS.currentLanguage, lang);
      return;
    }
    let files: I18nOverlayFile[];
    try {
      files = await this.i18nPort.loadOverlayFiles(lang);
    } catch (e: unknown) {
      this.fail(
        "i18n-overlay-failed",
        `载入 ${lang} 译文 overlay 失败（保持原语言）：${String(e)}`,
      );
      return;
    }
    this.overlay = mergeOverlayFiles(files); // 整表重建 = 老引擎「清缓存再载入」同语义
    this.setSystem(SYS.currentLanguage, lang);
  }

  /** 释放挂起定时器（UI 卸载/测试收尾）；监听器退订走 onXxx 返回的函数 */
  dispose(): void {
    this.clearTimer();
    this.abortMinigame(); // 挂载 signal abort → UI 卸载小游戏
    this.waitSkipable = false;
  }

  /**
   * 06 §二.1 会话命令 resolveMinigame：UI 小游戏完成后回填结果（02 §三.2 命令面）。
   * success → 奖励写状态（走 ValueChanged 事件流，历史可溯）→ on_success 分流；
   * fail → on_fail 分流；目标缺省 = 原列继续。非等待期/畸形结果 fail-closed（D5）。
   */
  resolveMinigame(result: MinigameResult): boolean {
    if (this.get(SYS.waiting) !== "minigame") {
      this.fail(
        "minigame-resolve-invalid",
        `resolveMinigame 仅在小游戏等待中有效（当前 __waiting=${String(this.get(SYS.waiting))}）`,
      );
      return false;
    }
    if (
      typeof result !== "object" ||
      result === null ||
      (result.outcome !== "success" && result.outcome !== "fail")
    ) {
      this.fail(
        "minigame-result-invalid",
        "resolveMinigame 需要 outcome = success | fail",
      );
      return false;
    }
    if (
      result.score !== undefined &&
      (typeof result.score !== "number" || !Number.isFinite(result.score))
    ) {
      this.fail(
        "minigame-result-invalid",
        "resolveMinigame.score 必须为有限数字",
      );
      return false;
    }
    const pending = this.pendingMinigame;
    if (pending === null) {
      this.fail("minigame-state-corrupt", "__waiting=minigame 但挂起状态缺失");
      return false;
    }
    this.pendingMinigame = null;
    this.minigameController = null; // 正常完成：不 abort（UI 已自行收尾）
    this.setSystem(SYS.waiting, "none");
    this.liveCheckpointed = false; // live 已越过该检查点（对齐 wait 完成语义）
    if (result.outcome === "success") {
      for (const entry of pending.reward) {
        this.setGlobal(entry.key, entry.value); // 奖励即状态变更（06 §二.2.4：历史可溯）
      }
    }
    const target =
      result.outcome === "success" ? pending.onSuccess : pending.onFail;
    if (target !== undefined && !this.enterColumn(target)) return false;
    this.run();
    return true;
  }

  // —— 内部实现 ——

  private clearTimer(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  /** 06 §二.2.3 回溯联动：中断小游戏等待 = abort 挂载信号（UI 卸载），重放到该坐标重新挂载 */
  private abortMinigame(): void {
    if (this.minigameController !== null) {
      this.minigameController.abort();
      this.minigameController = null;
    }
    this.pendingMinigame = null;
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

  /** 02 §三.1 出站事件统一发射：信封 `{v,kind:'event',payload}` + 广播全体监听者 */
  private emitEvent(payload: OutboundPayload): void {
    const event: OutboundEvent = { v: 1, kind: "event", payload };
    for (const listener of this.eventListeners) listener(event);
  }

  /** E3：engine.error 事件出站，绝不静默 */
  private fail(code: string, message: string): void {
    this.emitEvent({
      kind: "engine.error",
      code,
      message,
      coordinate: { ...this.coord },
    });
  }

  /**
   * 01 §四.3 Translate（老引擎 I18nService 同语义）：命中即用译文（含空串译文），未命中/
   * 无 overlay 回退原文；空原文直返。调用点必须**先于插值**——overlay 键可含 {var} 占位符
   * （插值在译文上进行，老引擎 hook 点同序）。
   */
  private translate(original: string): string {
    if (original === "" || this.overlay === null) return original;
    const hit = this.overlay.get(original);
    return hit === undefined ? original : hit;
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
      const frame = this.frames[this.frames.length - 1];
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
        case "navigate":
          if (!this.execNavigate(cmd)) return;
          continue;
        case "save":
          if (!this.execSaveOp(frame, cmd)) return;
          continue;
        case "load":
          if (!this.execLoadOp(frame, cmd)) return;
          continue;
        case "auto_save":
          if (!this.execAutoSaveOp(frame, cmd)) return;
          continue;
        case "save_delete":
          if (!this.execSaveDeleteOp(frame, cmd)) return;
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
            const loopFrame = this.frames[this.frames.length - 1]!;
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
        case "nvl":
          this.execNvl(cmd);
          frame.index += 1;
          continue;
        case "character":
          this.execCharacter(cmd);
          frame.index += 1;
          continue;
        case "bgm":
        case "se":
        case "ambient":
        case "stop_bgm":
        case "stop_ambient":
        case "voice":
        case "stop_voice":
          if (!this.execAudio(cmd)) return;
          frame.index += 1;
          continue;
        case "video":
        case "seek_video":
        case "pause_video":
        case "resume_video":
        case "stop_video":
        case "video_skipable":
          if (!this.execVideo(frame, cmd)) return;
          frame.index += 1;
          continue;
        case "cutscene":
          if (!this.execVideo(frame, cmd, true)) return;
          return; // 进入视频等待（ended/跳过解除；index 已前移）
        case "minigame":
          this.execMinigame(frame, cmd);
          return; // 进入小游戏等待（resolveMinigame 解除）
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
    if (
      cmd.template !== undefined &&
      (typeof cmd.template !== "string" || cmd.template === "")
    ) {
      this.fail(
        "say-invalid-template",
        "say.template 必须为非空字符串（模板注册名）",
      );
      return;
    }
    // 01 §四.3 先 Translate 后插值（overlay 键可含 {var} 占位符）+ {var:00} 格式化（F7：仅文本命令）；
    // 行内标记 {b}{p} 原样透传；失败保留原文 + error（S8）
    // speaker 与 text 同语义插值——动态说话人（如 func 实参）经此获得真实名字；
    // speaker 不走 Translate（老引擎 hook 点不含说话人——角色名归 character 注册表/NameResolver）
    const { text, errors } = interpolateText(
      this.translate(cmd.text),
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
    // 08 §四.5 模板三级优先级（老引擎 Phase 65 同语义）：
    // say template > character screen（按插值后说话人查表，与 UI 侧 U4 样式查表一致）> null(全局默认)
    const characterScreen = this.characters.get(speakerText)?.screen;
    this.setSystem(
      SYS.dialogTemplate,
      typeof cmd.template === "string"
        ? cmd.template
        : (characterScreen ?? null),
    );
    this.setSystem(SYS.currentDialogText, text);
    this.setSystem(SYS.dialogClickable, cmd.clickable === true);
    this.setSystem(SYS.dialogNoskip, cmd.noskip === true);
    // 08-U5：NVL 激活时当前句追加进累积缓冲（新引用，观察者可感知；随状态快照走）
    // 重放期不追加——buffer 已由快照恢复，重放只重建当前对话键
    if (this.get(SYS.nvlMode) === "active" && !this.rollbackActive) {
      const buffer = this.get(SYS.nvlBuffer);
      this.setSystem(SYS.nvlBuffer, [
        ...(Array.isArray(buffer) ? (buffer as string[]) : []),
        text,
      ]);
    }
    this.setSystem(SYS.waiting, "dialog");
    // 08 §六.1：say 的 voice 参数绑定本句语音进 voice 通道（auto_stop 默认 true → 推进过该句即停）
    if (typeof cmd.voice === "string" && cmd.voice !== "") {
      this.setSystem(SYS.audioVoice, {
        kind: "play",
        resource: cmd.voice,
        volume: 1,
        loop: false,
        fadeMs: 0,
        autoStop: true,
      } satisfies AudioChannelState);
    }
    // 重放落点（rollbackActive）即检查点 k 本体：live 视为已入档——back() 才能继续向前回退
    this.liveCheckpointed = this.rollbackActive;
    // 03-R1：快照在上屏时刻捕获（= 玩家所见画面，帧栈定位在本等待命令上），等待解除后才提交入档。
    // 重放期同样捕获：同坐标提交由 commitCheckpoint 原位替换（幂等），历史在回溯/读档路径上自愈完整
    this.pendingSay = this.takeSnapshot(this.checkpointCoord(frame));
    this.autoSaveAtCheckpoint(); // 05 §四：say 等待画面建立 = 玩家所见稳定点，auto_save 开关消费
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

  /**
   * 01 §二.1 navigate op：跨列导航。目标列 = scene ?? path（老引擎 NavigateHandler
   * 优先级语义），二者都是 columnId（01 §一.2：列名即标签，「文件」在组装模型中坍缩为列）。
   * 与 jump 的语义差异 = 清旧列对话镜像（导航 = 画面边界，老引擎导航清屏语义）+
   * path/scene 词汇（灵泛 JSON v1 契约照搬）。**不建检查点**（裁定）：老引擎 navigate
   * 建检查点的语义在新引擎检查点模型下产生回溯陷阱——导航站重放必重建下一站的等待画面，
   * flush 提交命中前向同坐标站使 cursor 前移，back 原地循环；03-R1「检查点=玩家所见」
   * 下导航边界由前后所见站界定。
   */
  private execNavigate(cmd: StoryCommand): boolean {
    const scene =
      typeof cmd.scene === "string" && cmd.scene !== "" ? cmd.scene : null;
    const target = scene ?? (typeof cmd.path === "string" ? cmd.path : "");
    if (target === "") {
      this.fail(
        "navigate-invalid",
        "navigate 需要 path（scene 可选；二者皆为目标列 id）",
      );
      return false;
    }
    this.setSystem(SYS.currentDialogText, ""); // 清旧列对话镜像（老引擎导航清屏语义）
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(SYS.dialogComplete, false);
    return this.enterColumn(target);
  }

  /**
   * 01 §二.3 save op：声明存档点——载荷落到**下一玩家所见等待画面**（05 §四：存档坐标
   * 必须是可重放重建的等待点；灵泛「命令位置快照」与此不同构，重放侧效即由此规避）。
   * 槽位/端口校验立即 fail-closed；声明本身非等待命令，故事立即继续。
   */
  private execSaveOp(frame: Frame, cmd: StoryCommand): boolean {
    const unknownFields = Object.keys(cmd).filter(
      (k) => !SAVE_FIELDS.save.has(k),
    );
    if (unknownFields.length > 0) {
      this.fail(
        "save-unknown-field",
        `save 未知负载字段：${unknownFields.join(", ")}`,
      );
      return false;
    }
    if (typeof cmd.slot !== "string" || !validSlot(cmd.slot)) {
      this.fail(
        "save-invalid-slot",
        "save.slot 必填且槽位名合法（字母数字/_/-，1..64）",
      );
      return false;
    }
    if (cmd.title !== undefined && typeof cmd.title !== "string") {
      this.fail("save-invalid", "save.title 必须为字符串");
      return false;
    }
    if (this.savePort === undefined) {
      this.fail(
        "save-unavailable",
        "未装配 SavePort（组合根经 EngineOptions 注入）",
      );
      return false;
    }
    this.pendingSave = {
      slot: cmd.slot,
      title: typeof cmd.title === "string" ? cmd.title : undefined,
    };
    frame.index += 1; // 非等待命令：推进游标（run 循环 continue 后取下一条）
    return true;
  }

  /** 01 §二.3 load op：读档传送（复用会话命令 load；异步 importSave 后即传送） */
  private execLoadOp(frame: Frame, cmd: StoryCommand): boolean {
    const unknownFields = Object.keys(cmd).filter(
      (k) => !SAVE_FIELDS.load.has(k),
    );
    if (unknownFields.length > 0) {
      this.fail(
        "load-unknown-field",
        `load 未知负载字段：${unknownFields.join(", ")}`,
      );
      return false;
    }
    if (typeof cmd.slot !== "string" || cmd.slot === "") {
      this.fail("load-invalid", "load.slot 必填（槽位名）");
      return false;
    }
    const kicked = this.load(cmd.slot);
    if (kicked) frame.index += 1; // kick 成功即推进（异步传送由 importSave 接管后续）
    return kicked;
  }

  /**
   * 01 §二.3 auto_save op：开关系统键 `__auto_save`（灵泛编译为 SetVariableCommand 同语义）。
   * 消费点 = 等待画面建立时（autoSaveAtCheckpoint）；开关是系统键 → 不进用户存档、读档后复位。
   */
  private execAutoSaveOp(frame: Frame, cmd: StoryCommand): boolean {
    const unknownFields = Object.keys(cmd).filter(
      (k) => !SAVE_FIELDS.auto_save.has(k),
    );
    if (unknownFields.length > 0) {
      this.fail(
        "auto_save-unknown-field",
        `auto_save 未知负载字段：${unknownFields.join(", ")}`,
      );
      return false;
    }
    if (cmd.enabled !== true && cmd.enabled !== false) {
      this.fail(
        "auto_save-invalid",
        "auto_save.enabled 必须为布尔（true/false）",
      );
      return false;
    }
    this.setSystem(SYS.autoSave, cmd.enabled);
    frame.index += 1; // 非等待命令：推进游标
    return true;
  }

  /** 01 §二.3 save_delete op：删除槽位（异步 kick；05 K4：删档不动高水位——防回档基准不随删档回退） */
  private execSaveDeleteOp(frame: Frame, cmd: StoryCommand): boolean {
    const unknownFields = Object.keys(cmd).filter(
      (k) => !SAVE_FIELDS.save_delete.has(k),
    );
    if (unknownFields.length > 0) {
      this.fail(
        "save_delete-unknown-field",
        `save_delete 未知负载字段：${unknownFields.join(", ")}`,
      );
      return false;
    }
    if (typeof cmd.slot !== "string" || !validSlot(cmd.slot)) {
      this.fail("save_delete-invalid", "save_delete.slot 必填且槽位名合法");
      return false;
    }
    if (this.savePort === undefined) {
      this.fail(
        "save-unavailable",
        "未装配 SavePort（组合根经 EngineOptions 注入）",
      );
      return false;
    }
    const slot = cmd.slot;
    void this.savePort.remove(slot).catch((e: unknown) => {
      this.fail("save-delete-failed", `槽位 ${slot} 删除失败：${String(e)}`);
    });
    frame.index += 1; // 非等待命令：推进游标
    return true;
  }

  /** menu：写菜单系统键 → 进入 menu 等待（02 §二.2；清对话残留 08 §二.6） */
  private execMenu(frame: Frame, cmd: StoryCommand): void {
    const options = cmd.options as Array<{ text: string; target: string }>; // 解析器已验证结构
    this.setSystem(SYS.currentDialogText, "");
    this.setSystem(SYS.currentDialogSpeaker, "");
    // 01 §四.3：prompt/选项文案先 Translate（目标列名不翻译——menuTargets 原样）
    this.setSystem(
      SYS.menuPrompt,
      typeof cmd.prompt === "string" ? this.translate(cmd.prompt) : "",
    );
    this.setSystem(
      SYS.menuOptions,
      options.map((o) => this.translate(o.text)),
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
    this.autoSaveAtCheckpoint(); // 05 §四：菜单等待画面建立 = auto_save 消费点
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
    this.autoSaveAtCheckpoint(); // 05 §四：wait 等待画面建立 = auto_save 消费点
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
    return this.beginLoopIteration(this.frames[this.frames.length - 1]!, loop);
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
    return this.beginLoopIteration(this.frames[this.frames.length - 1]!, loop);
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
        const scope = this.frames[this.frames.length - 1]?.scope;
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

  /** 08-U5 NVL：进入/清屏/退出累积层（01 §二.2 → 08 §五）；累积文本进核心状态（回溯/存档自动一致） */
  private execNvl(cmd: StoryCommand): void {
    const mode = typeof cmd.mode === "string" ? cmd.mode : "enter";
    switch (mode) {
      case "clear":
        // 清屏保留窗口：累积清空，NVL 仍激活
        this.setSystem(SYS.nvlBuffer, []);
        this.setSystem(SYS.nvlMode, "active");
        break;
      case "exit":
        this.setSystem(SYS.nvlBuffer, []);
        this.setSystem(SYS.nvlMode, "none");
        break;
      default:
        // enter / auto：进入累积层
        this.setSystem(SYS.nvlMode, "active");
    }
  }

  /** 08-U4 character：注册/更新角色定义（灵泛 DefineCharacter 语义：可覆盖更新） */
  private execCharacter(cmd: StoryCommand): void {
    const key = cmd.key as string;
    const def: CharacterDef = { key };
    if (typeof cmd.name === "string") def.name = cmd.name;
    if (typeof cmd.color === "string") def.color = cmd.color;
    if (typeof cmd.size === "string") def.size = cmd.size;
    if (typeof cmd.font === "string") def.font = cmd.font;
    if (typeof cmd.textColor === "string") def.textColor = cmd.textColor;
    if (typeof cmd.screen === "string") def.screen = cmd.screen;
    this.characters.set(key, def);
  }

  /** 08-U4 查询角色定义（UI 渲染 say speaker 时套用） */
  getCharacter(key: string): CharacterDef | undefined {
    return this.characters.get(key);
  }

  getCharacters(): CharacterDef[] {
    return [...this.characters.values()];
  }

  /**
   * 08 §六.1 四音频通道：核心只写状态（U1），播放由 UI 适配器落地。
   * - bgm/ambient/voice 为常驻通道（写状态对象，随快照/存档随行）；se 为一次性触发（单调 seq）
   * - 同资源重写保留播放位置：重放不打断当前曲目（03-R7「回滚 seek」/ 05 §四「读档续播」）
   * - stop_* 写 stop 形态（带淡出参数）；未知字段/非法负载 fail-closed（E3/F5）
   */
  private execAudio(cmd: StoryCommand): boolean {
    const unknown = Object.keys(cmd).filter(
      (k) => !(AUDIO_FIELDS[cmd.op]?.has(k) ?? false),
    );
    if (unknown.length > 0) {
      this.fail(
        `${cmd.op}-unknown-field`,
        `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
      );
      return false;
    }
    const fade = this.audioFade(cmd.fade, cmd.op);
    if (fade === null) return false;
    if (
      cmd.op === "stop_bgm" ||
      cmd.op === "stop_ambient" ||
      cmd.op === "stop_voice"
    ) {
      // 清通道为停止形态（淡出参数随状态走，不被丢弃）
      const stopKey = AUDIO_STOP_KEY[cmd.op]!;
      this.setSystem(stopKey, {
        kind: "stop",
        fadeMs: fade,
      } satisfies AudioChannelState);
      // 停止背景乐：播放位置归零（帧级键静默写，08 §三.3）
      if (cmd.op === "stop_bgm") this.state.set(SYS.bgmPosition, 0);
      return true;
    }
    if (typeof cmd.resource !== "string" || cmd.resource === "") {
      this.fail(
        `${cmd.op}-invalid-resource`,
        `${cmd.op} 需要非空 resource 字符串`,
      );
      return false;
    }
    const volume = this.audioVolume(cmd.volume, cmd.op);
    if (volume === null) return false;
    if (cmd.op === "se") {
      this.mediaSeq += 1;
      this.setSystem(SYS.audioSe, {
        kind: "play",
        resource: cmd.resource,
        volume,
        loop: false,
        fadeMs: 0,
        seq: this.mediaSeq,
      } satisfies AudioChannelState);
      return true;
    }
    const channelKey = AUDIO_CHANNEL_KEY[cmd.op]!;
    const previous = this.get(channelKey) as
      AudioChannelState | null | undefined;
    const restart = cmd.restart === true;
    if (cmd.op === "bgm") {
      // 首播/换曲/显式重播归零；同曲静默续播（03-R7 回滚 seek / 05 §四 读档续播）。
      // 帧级键静默写（08 §三.3 高频键不进事件流），UI 经通道事件重读位置。
      const sameTrack =
        previous?.kind === "play" && previous.resource === cmd.resource;
      if (!sameTrack || restart) this.state.set(SYS.bgmPosition, 0);
    }
    const state: AudioChannelState = {
      kind: "play",
      resource: cmd.resource,
      volume,
      loop: cmd.op === "voice" ? false : cmd.loop !== false,
      fadeMs: fade,
    };
    if (cmd.op === "voice") state.autoStop = cmd.auto_stop !== false;
    if (restart) {
      // 单调序号：同曲连续两次 restart 也是两次独立事件（渲染层据此重播）
      this.mediaSeq += 1;
      state.restart = true;
      state.seq = this.mediaSeq;
    }
    this.setSystem(channelKey, state);
    return true;
  }

  /** volume 窄化：缺省 1；非有限数字 fail-closed，越界按物理范围钳制 */
  private audioVolume(raw: unknown, op: string): number | null {
    if (raw === undefined) return 1;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      this.fail(`${op}-invalid-volume`, `${op} 的 volume 必须是有限数字`);
      return null;
    }
    return Math.min(1, Math.max(0, raw));
  }

  /** fade 窄化：缺省 0；负数/非有限数字 fail-closed */
  private audioFade(raw: unknown, op: string): number | null {
    if (raw === undefined) return 0;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      this.fail(
        `${op}-invalid-fade`,
        `${op} 的 fade 必须是非负有限数字（毫秒）`,
      );
      return null;
    }
    return raw;
  }

  /**
   * 08 §六.5 视频族：核心只写命令流（`__video`，seq 单调），渲染器按序执行。
   * - `video` = 非阻塞播放（故事继续）；`cutscene` = 阻塞过场（等待建立时提交检查点，
   *   同 menu/wait/input；ended/跳过解除）。
   * - `seek_video`/`pause_video`/`resume_video`/`stop_video` 为离散命令；
   *   `video_skipable` 设后续 video/cutscene 的缺省 skipable。
   */
  private execVideo(
    frame: Frame,
    cmd: StoryCommand,
    cutscene = false,
  ): boolean {
    const known = VIDEO_FIELDS[cmd.op]!;
    const unknown = Object.keys(cmd).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      this.fail(
        `${cmd.op}-unknown-field`,
        `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
      );
      return false;
    }
    this.videoSeq += 1;
    const seq = this.videoSeq;
    if (cmd.op === "video" || cmd.op === "cutscene") {
      if (typeof cmd.resource !== "string" || cmd.resource === "") {
        this.fail(
          `${cmd.op}-invalid-resource`,
          `${cmd.op} 需要非空 resource 字符串`,
        );
        return false;
      }
      const volume = this.audioVolume(cmd.volume, cmd.op);
      if (volume === null) return false;
      // skipable：cutscene 显式参数 > video_skipable 持久开关（缺省可跳）
      const skipable =
        cutscene && cmd.skipable !== undefined
          ? cmd.skipable === true
          : this.get(SYS.videoSkipable) !== false;
      this.setSystem(SYS.video, {
        kind: "play",
        resource: cmd.resource,
        volume,
        loop: cmd.loop === true,
        cutscene,
        skipable,
        seq,
      } satisfies VideoCommand);
      if (cutscene) {
        // 03 §三：过场等待建立时提交检查点（同 menu/wait/input）；重放期同坐标原位替换
        this.setSystem(SYS.waiting, "video");
        this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
        this.liveCheckpointed = true;
        this.autoSaveAtCheckpoint(); // 05 §四：cutscene 等待画面建立 = auto_save 消费点
        frame.index += 1;
      }
      return true;
    }
    if (cmd.op === "seek_video") {
      const seconds = cmd.seconds;
      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0
      ) {
        this.fail(
          "seek_video-invalid-seconds",
          "seek_video 需要非负有限数字（秒）",
        );
        return false;
      }
      this.setSystem(SYS.video, {
        kind: "seek",
        seconds,
        seq,
      } satisfies VideoCommand);
      return true;
    }
    if (cmd.op === "pause_video") {
      this.setSystem(SYS.video, { kind: "pause", seq } satisfies VideoCommand);
      return true;
    }
    if (cmd.op === "resume_video") {
      this.setSystem(SYS.video, { kind: "resume", seq } satisfies VideoCommand);
      return true;
    }
    if (cmd.op === "stop_video") {
      this.setSystem(SYS.video, { kind: "stop", seq } satisfies VideoCommand);
      return true;
    }
    // video_skipable
    this.setSystem(SYS.videoSkipable, cmd.value !== false);
    return true;
  }

  /**
   * 08 §六.5 过场完成（UI 播放结束回调）：解除 video 等待，故事继续。
   * 检查点已在过场建立时提交（重放不再重看）。
   */
  videoFinished(): void {
    if (this.get(SYS.waiting) !== "video") {
      this.fail("video-finish-invalid", "当前不在视频等待中");
      return;
    }
    this.setSystem(SYS.waiting, "none");
    this.liveCheckpointed = false; // live 已越过该检查点
    this.run();
  }

  /**
   * 08 §三.2 媒体位置帧级回写（UI 每帧轮询播放器）。
   * 帧级键静默写：不进事件流（U2，防事件风暴）；随快照/存档持久化（03-R7 / 05 §四）。
   */
  reportMediaPosition(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return; // 播放器噪声值忽略
    this.state.set(SYS.bgmPosition, seconds);
  }

  /** notify：出站 toast 事件（01 §二.1 → 08 §二.4 覆盖层）；文本插值与 say 同语义 */
  private execNotify(cmd: StoryCommand): void {
    const { text, errors } = interpolateText(
      this.translate(cmd.text as string),
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

  /**
   * 06 §二.1 minigame op：建立小游戏等待（同 menu/wait/input 建立检查点），
   * 发布挂载事件（signal 供回溯/中断卸载，D5）。语义裁定：reward.value 执行期求值
   * （支持 {expr}，重放经 rngState 恢复保持确定性）；on_success/on_fail 缺省 = 原列继续。
   */
  private execMinigame(frame: Frame, cmd: StoryCommand): void {
    const unknownFields = Object.keys(cmd).filter(
      (k) => !MINIGAME_FIELDS.has(k),
    );
    if (unknownFields.length > 0) {
      this.fail(
        "minigame-unknown-field",
        `minigame 未知负载字段：${unknownFields.join(", ")}`,
      );
      return;
    }
    if (typeof cmd.game !== "string" || cmd.game === "") {
      this.fail(
        "minigame-invalid",
        "minigame 需要非空 game 字符串（注册 gameId）",
      );
      return;
    }
    if (
      cmd.config !== undefined &&
      (typeof cmd.config !== "object" ||
        cmd.config === null ||
        Array.isArray(cmd.config))
    ) {
      this.fail("minigame-invalid", "minigame.config 必须为对象");
      return;
    }
    for (const field of ["on_success", "on_fail"] as const) {
      const target = cmd[field];
      if (
        target !== undefined &&
        (typeof target !== "string" || target === "")
      ) {
        this.fail(
          "minigame-invalid",
          `minigame.${field} 必须为非空字符串（目标列）`,
        );
        return;
      }
    }
    const reward: { key: string; value: unknown }[] = [];
    if (cmd.reward !== undefined) {
      if (!Array.isArray(cmd.reward)) {
        this.fail("minigame-invalid", "minigame.reward 必须为键值数组");
        return;
      }
      for (const [i, entry] of cmd.reward.entries()) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          Array.isArray(entry) ||
          typeof (entry as { key?: unknown }).key !== "string" ||
          (entry as { key: string }).key === "" ||
          !("value" in entry)
        ) {
          this.fail(
            "minigame-invalid",
            `minigame.reward[${i}] 必须为 { key, value }（key 非空字符串，value 必填）`,
          );
          return;
        }
        try {
          reward.push({
            key: (entry as { key: string }).key,
            value: this.evalValue((entry as { value: unknown }).value),
          });
        } catch (e) {
          if (e instanceof ExpressionError) {
            this.fail(e.code, e.message);
            return;
          }
          throw e;
        }
      }
    }
    this.minigameSeq += 1;
    const seq = this.minigameSeq;
    this.minigameController = new AbortController();
    this.pendingMinigame = {
      onSuccess:
        typeof cmd.on_success === "string" ? cmd.on_success : undefined,
      onFail: typeof cmd.on_fail === "string" ? cmd.on_fail : undefined,
      reward,
    };
    this.setSystem(SYS.minigame, {
      game: cmd.game,
      config: (cmd.config ?? {}) as Record<string, unknown>,
      seq,
    });
    this.setSystem(SYS.waiting, "minigame");
    // 03 §三：等待建立时提交检查点；重放期同坐标原位替换（重放重新挂载 = 新 seq 新 signal）
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    this.autoSaveAtCheckpoint(); // 05 §四：小游戏等待画面建立 = auto_save 消费点
    frame.index += 1;
    const payload: OutboundPayload = {
      kind: "minigame.mount",
      game: cmd.game,
      config: (cmd.config ?? {}) as Record<string, unknown>,
      signal: this.minigameController.signal,
      seq,
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
      // 读档重放跨 JSON 序列化 → body 引用必然不同，须按语义比较（params 逐位 + body 序列化一致）
      const identical =
        registered.params.length === next.params.length &&
        registered.params.every((p, i) => p === next.params[i]) &&
        JSON.stringify(registered.body) === JSON.stringify(next.body);
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
      typeof cmd.prompt === "string" ? this.translate(cmd.prompt) : "",
    );
    this.inputStore = cmd.store as string;
    this.setSystem(SYS.waiting, "input");
    // 03 §三：input 检查点在等待建立时；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    this.autoSaveAtCheckpoint(); // 05 §四：input 等待画面建立 = auto_save 消费点
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
    this.abortMinigame(); // 读档打断小游戏：abort 挂载信号（重放重新挂载）
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
    this.abortMinigame(); // 回溯打断小游戏：abort 挂载信号，重放重新挂载（06 §二.2.3）
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
   * 05 §四 存档点消费：等待画面建立（say 上屏 / menu / wait / input）= 玩家所见稳定点。
   * ①save op 的一次性声明（pendingSave）优先落档（一画面一写）；②auto_save 开关持续写专用
   * `auto` 槽。解除时提交（waiting=none）与重放期（rollbackActive）不触发；
   * 异步失败经 engine.error 可观测（不吞）。
   */
  private autoSaveAtCheckpoint(): void {
    if (this.rollbackActive) return;
    if (this.savePort === undefined) return;
    const waiting = this.get(SYS.waiting);
    if (waiting === undefined || waiting === "none") return;
    const pending = this.pendingSave;
    if (pending !== null) {
      this.pendingSave = null;
      const data = this.exportSave();
      if (data === null) return; // 不在等待点（理论不可达，防御；exportSave 已发错误）
      const payload: SaveDataV1 =
        pending.title === undefined ? data : { ...data, title: pending.title };
      void this.savePort
        .write(pending.slot, JSON.stringify(payload), this.saveMode)
        .catch((e: unknown) => {
          this.fail(
            "save-write-failed",
            `槽位 ${pending.slot} 写档失败：${String(e)}`,
          );
        });
      return; // pending 消费即本画面已写，不叠加 auto 写
    }
    if (this.get(SYS.autoSave) !== true) return;
    const data = this.exportSave();
    if (data === null) return;
    void this.savePort
      .write("auto", JSON.stringify(data), this.saveMode)
      .catch((e: unknown) => {
        this.fail("save-write-failed", `自动存档写入失败：${String(e)}`);
      });
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
    this.emitEvent({ kind: "rollback.done", coordinate: { ...this.coord } });
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

  /**
   * 07 §三.2 热重载（灵泛 StoryHotReload 语义）：原子替换故事树，运行态保留
   * （变量/函数/历史检查点不动——回溯按新列内容重放，文案即改即所见），
   * 当前列重入（等待打断，画面由重放重建）；当前列在新树中不存在 → engine.error 后回入口列。
   */
  reloadStory(story: Story): void {
    if (!this.started) {
      this.fail("reload-invalid", "故事尚未启动");
      return;
    }
    this.story = story;
    const current = this.get(SYS.currentSceneColumn);
    const currentId = typeof current === "string" ? current : "";
    let targetId = currentId;
    if (currentId === "" || this.columnById(currentId) === undefined) {
      if (currentId !== "") {
        this.fail(
          "reload-column-missing",
          `当前列 ${currentId} 在新故事中不存在，回退入口列 ${story.entry}`,
        );
      }
      targetId = story.entry;
    }
    this.flushPendingCheckpoint(); // 离开当前画面：所见即入档
    this.clearTimer();
    this.abortMinigame(); // 热重载打断小游戏：abort 挂载信号
    this.waitSkipable = false;
    this.liveCheckpointed = false;
    this.setSystem(SYS.waiting, "none");
    if (!this.enterColumn(targetId)) return; // 入口列也缺失 = 兜底 fail-closed（组装器已保证存在）
    this.run();
  }

  /**
   * 03 §四 历史面板数据（前端职责的可视化皮）：对话类检查点带说话者与文本；
   * NVL 检查点额外带 `nvl` 标记与**累积行快照**（nvlLines = 该时刻玩家已见的整块文本）——
   * 宿主按「段聚合」呈现（历史不灌水），回溯粒度不变（逐检查点仍全在 history 里）。
   */
  historyView(): Array<{
    index: number;
    coord: ColumnCoordinate;
    speaker: string;
    text: string;
    nvl: boolean;
    nvlLines: string[];
  }> {
    return this.history.map((cp, index) => {
      const mode = cp.snapshot.state.find(([k]) => k === SYS.nvlMode)?.[1];
      const buffer = cp.snapshot.state.find(([k]) => k === SYS.nvlBuffer)?.[1];
      return {
        index,
        coord: { ...cp.coord },
        speaker: snapshotText(cp, SYS.currentDialogSpeaker),
        text: snapshotText(cp, SYS.currentDialogText),
        nvl: mode === "active",
        nvlLines:
          mode === "active" && Array.isArray(buffer)
            ? (buffer as string[])
            : [],
      };
    });
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
    const scope = this.frames[this.frames.length - 1]?.scope;
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

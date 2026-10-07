/**
 * 执行模型：SSOT 状态容器 + 帧栈式逐命令解释执行 + advance/choose 命令面。
 * 作用域：块/列级 Scope 树 + 全局（SSOT Map）；块/列级不进存档。
 * 框架无关：只写状态与事件，渲染归 UI 层。
 */
import type {
  AnimationSpec,
  AudioChannelState,
  CharacterDef,
  ColumnCoordinate,
  ElementInstance,
  EventListener,
  I18nOverlayFile,
  I18nPort,
  MinigameResult,
  OpExtension,
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
import { ELEMENT_ATTRIBUTES, EXT_KEY_PREFIX, RESERVED_STATE_KEYS, SYS } from "../contracts";
import { isReplayableColumn } from "../contracts";
import {
  buildExtensionContext,
  buildOpRegistry,
  runRegisteredOp,
  type RegisteredOp,
} from "./opRegistry";
import {
  findElements as findElementsIn,
  loadElements,
  removeElements,
} from "../data/element";
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
import { findJsonValueError } from "./stateContract";

/** say 的已知负载字段；未知字段 fail-closed */
const SAY_KNOWN_FIELDS = new Set([
  "op",
  "text",
  "speaker",
  // 说话人颜色覆盖（覆盖整句/说话人；与行内标记 `{color=…}` 是两件事）
  "color",
  "clickable",
  "noskip",
  "instant",
  "typewriter",
  "voice",
  "template",
  "z", // 实例级 z（dialogue 层）
]);

/** 十六进制颜色（`#RGB` / `#RRGGBB` / `#RRGGBBAA`）——`say color` 的**统一校验口径** */
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** `say color` 的校验（编辑器 schema 与本处**同一口径**；导出供编辑器复用，杜绝两处漂移） */
export function isValidSayColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

const WAIT_FIELDS = new Set(["op", "seconds", "skipable"]);
const PAUSE_FIELDS = new Set(["op", "seconds"]);

/** 音频 op 已知负载字段（未知字段 fail-closed） */
const AUDIO_FIELDS: Record<string, ReadonlySet<string>> = {
  bgm: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  se: new Set(["op", "resource", "volume"]),
  ambient: new Set(["op", "resource", "volume", "loop", "fade", "restart"]),
  stop_bgm: new Set(["op", "fade"]),
  stop_ambient: new Set(["op", "fade"]),
  voice: new Set(["op", "resource", "volume", "auto_stop", "restart"]),
  stop_voice: new Set(["op", "fade"]),
};

/**
 * 元素增删 op 已知负载字段（未知字段 fail-closed）。
 * `show.target` = 资源路径（落 `props.source`）。
 */
const ELEMENT_OP_FIELDS: Record<string, ReadonlySet<string>> = {
  show: new Set(["op", "target", "x", "y", "id", "name", "background"]),
  hide: new Set(["op", "target"]),
  background: new Set(["op", "resource"]),
  bg_switch: new Set(["op", "resource"]),
  zindex: new Set(["op", "target", "value"]),
  style: new Set(["op", "target", "props"]),
  window: new Set(["op", "mode"]),
  animate: new Set(["op", "target", "property", "value", "duration", "easing"]),
  animate_block: new Set([
    "op",
    "target",
    "x",
    "y",
    "opacity",
    "rotation",
    "scale",
    "duration",
    "easing",
  ]),
  transition: new Set(["op", "type", "duration"]),
  shake: new Set(["op", "intensity", "duration"]),
  text_typewriter: new Set(["op", "enabled", "speed"]),
};

/** `animate_block` 可承载的属性（与既有实现的属性集一致） */
const ANIMATE_BLOCK_PROPS: readonly string[] = [
  "x",
  "y",
  "opacity",
  "rotation",
  "scale",
];

/** 背景元素固定底层序（`Order = -1000`） */
const BACKGROUND_Z = -1000;

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

/** 视频族已知负载字段（未知字段 fail-closed） */
const VIDEO_FIELDS: Record<string, ReadonlySet<string>> = {
  video: new Set(["op", "resource", "volume", "loop", "z"]),
  cutscene: new Set(["op", "resource", "volume", "skipable", "z"]),
  seek_video: new Set(["op", "seconds"]),
  pause_video: new Set(["op"]),
  resume_video: new Set(["op"]),
  stop_video: new Set(["op"]),
  video_skipable: new Set(["op", "value"]),
};

/** minigame 已知负载字段（未知字段 fail-closed） */
const MINIGAME_FIELDS = new Set([
  "op",
  "game",
  "config",
  "on_success",
  "on_fail",
  "reward",
  "z", // 实例级 z（minigame 层）
]);

/** 存档类 op 已知负载字段（未知字段 fail-closed） */
const SAVE_FIELDS: Record<string, ReadonlySet<string>> = {
  save: new Set(["op", "slot", "title"]),
  load: new Set(["op", "slot"]),
  auto_save: new Set(["op", "enabled"]),
  save_delete: new Set(["op", "slot"]),
};

/** set 复合赋值前缀（value 支持 {expr} 与 += 等复合赋值） */
const COMPOUND_PREFIX = /^\s*(\+=|-=|\*=|\/=|%=)\s*([\s\S]+)$/;

/** 防死循环安全网：单个循环帧的迭代上限（fail-closed） */
const LOOP_LIMIT = 10000;

/**
 * 快照：状态 + rngState + 帧栈。
 * 不变量：状态容器的值写时复制（array/dict 每次写入新引用），故浅拷贝 entries 即安全。
 */
interface EngineSnapshot {
  state: [string, unknown][];
  rngState: number;
  frames: Frame[];
  coord: ColumnCoordinate;
  /** 函数注册表随快照恢复——回溯到 func 之前的检查点重放时必须可重新注册 */
  functions: [string, { params: string[]; body: StoryCommand[] }][];
}

/** 检查点 = 坐标 + 快照；重放 = 恢复快照后从该命令重新解释执行到同一等待点 */
interface Checkpoint {
  coord: ColumnCoordinate;
  snapshot: EngineSnapshot;
}

export interface EngineOptions {
  /** 历史容量上限（默认 200），超限淘汰最旧 */
  historyLimit?: number;
  /** 确定性随机：初始 rng 种子（缺省按当前时间） */
  rngSeed?: number;
  /** 存档编排端口（save/load/auto_save/save_delete op 与命令面 save/load 的依赖；缺省 = 存档类 op fail-closed） */
  savePort?: SavePort;
  /** 存档模式（缺省 machine-bound；Rust 层同缺省） */
  saveMode?: SaveMode;
  /** I18N overlay 供给端口（setLanguage 按需加载译文；缺省 = 原文直出） */
  i18nPort?: I18nPort;
  /** 自定义 op 扩展（构造期注册校验，fail-fast；缺省 = 无扩展，unknown-op 口径不变） */
  extensions?: readonly OpExtension[];
  /**
   * 存档版本迁移钩子：`formatVersion` 非 1 的档先经此迁移（返回 v1 载荷 = 放行并发
   * `load.notice`；返回 null = 无法迁移 → 可操作拒绝）。缺省 = 非 v1 档直接可操作拒绝。
   */
  migrateSave?: (data: unknown) => SaveDataV1 | null;
  /**
   * 运行期守卫注册表（组合根注入，信任域 = 组合根；缺省 = guard op 一律 guard-unknown）。
   * 签名 `(ctx, args)`：ctx = 引擎沙箱上下文（get/fail，**契约只增**——后续能力长在 ctx 上）；
   * args = 故事数据提供的纯数据参数（与 call 的 args 同族）。失败（ctx.fail 或抛出）⇒
   * engine.error + 状态原样 + 停在当前命令（fail-closed 拦截）。守卫**不改状态**（ctx 无 set——
   * 校验/拦截归守卫，改状态归 set/自定义 op）。
   */
  guards?: Readonly<Record<string, GuardFn>>;
}

/** 守卫的引擎沙箱上下文（首版 = get/fail；**契约只增**：新能力以可选方法扩展） */
export interface GuardContext {
  /** 读 SSOT 状态（含 `__` 系统键；与引擎 get 同口径） */
  get(key: string): unknown;
  /** 拦截：立即中止守卫并以该消息 fail-closed（状态原样 + 停在当前命令） */
  fail(message: string): never;
}

/** 运行期守卫函数：纯逻辑（同状态同 args 同结果 ⇒ 重放同位同判）；不改状态 */
export type GuardFn = (ctx: GuardContext, args: Record<string, unknown>) => void;

/** 守卫拦截的内部标记（ctx.fail 抛出 ⇒ execGuard 捕获转 engine.error） */
class GuardFailure extends Error {}

/** 槽位信任边界（与 Rust validate_slot 同判）：字母数字/_/-，1..64 */
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

/**
 * 解析 `__menu_return` 记账（进入 menu/ui 前记下的游戏点）。
 *
 * **fail-closed**：形状不符 ⇒ 返回 `null`（= 没有可返回的游戏进度 ⇒ 拒绝存档）。
 * 宁可拒绝也不能存出一个指向非法坐标的档（读档会炸在重放里）。
 */
function parseMenuReturn(raw: unknown): { coord: ColumnCoordinate; waiting: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as { coord?: unknown; waiting?: unknown };
  const coord = rec.coord;
  if (typeof coord !== "object" || coord === null) return null;
  const c = coord as { columnId?: unknown; index?: unknown };
  if (typeof c.columnId !== "string" || c.columnId === "") return null;
  if (typeof c.index !== "number" || !Number.isFinite(c.index)) return null;
  return {
    coord: { columnId: c.columnId, index: Math.max(0, Math.trunc(c.index)) },
    waiting: typeof rec.waiting === "string" ? rec.waiting : "none",
  };
}

/** 快照状态中的字符串键值（缺省/非字符串 = 空串） */
function snapshotText(cp: Checkpoint, key: string): string {
  const found = cp.snapshot.state.find(([k]) => k === key)?.[1];
  return typeof found === "string" ? found : "";
}

/**
 * 循环帧状态：while 每轮重判条件；for/foreach 物化数组逐元素推进
 * （foreach 编译为等价循环结构：len(expr) + expr[idx] 运行时求值）。
 */
interface LoopState {
  kind: "while" | "iterate";
  /** while：条件表达式原文（每轮执行期重判） */
  cond?: unknown;
  /** iterate：循环变量名与物化元素序列 */
  varName?: string;
  items?: ExprValue[];
  /** 循环体外层作用域：每轮重建块级 */
  parentScope: Scope;
  iterations: number;
}

/**
 * 执行帧：列帧（columnId 非空，作用域 = 列级）与块帧（columnId 空，作用域 = 块级）。
 * 嵌套块不进坐标——坐标恒指列内顶层位置，块内进度由帧栈承载，
 * 快照时帧栈随状态一并保存即可满足确定性重放。
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
  // —— 03 回溯与历史 ——
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
  }

  // —— 观察接缝 ——

  /** ValueChanged 是唯一观察接缝；所有状态写入都经 set 系方法镜像到这里 */
  onStateChanged(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** 出站事件信封：engine.error / notify 等 */
  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** 帧循环直读：帧级键由 UI 每帧直读，不进事件流 */
  get(key: string): unknown {
    return this.state.get(key);
  }

  // —— 会话命令面（最小子集：start / advance / choose） ——

  /** story.start：导航至入口列（entry 取自 project.json） */
  start(): void {
    if (this.started) {
      this.fail("already-started", "故事已启动，重复 start 无效");
      return;
    }
    this.started = true;
    // NVL 模式从 start 起恒有定义（静默初始化——事件流只承载离散变化）
    this.state.set(SYS.nvlMode, "none");
    // 当前语言从 start 起恒有定义（空串 = 默认语言/原文直出）
    this.state.set(SYS.currentLanguage, "");
    // 顶层 defines 无条件 Set（全局层 = SSOT Map）
    for (const [key, value] of Object.entries(this.story.defines ?? {})) {
      this.setGlobal(key, value);
    }
    if (!this.enterColumn(this.story.entry)) return;
    this.run();
  }

  /**
   * advance = `__dialog_complete = true`——对话推进唯一入口。
   * wait 等待的「用户点击解除」（skipable 时）复用本命令，命令面保持最小。
   */
  advance(): void {
    if (!this.started) {
      this.fail("advance-invalid", "故事尚未启动");
      return;
    }
    const waiting = this.get(SYS.waiting);
    if (waiting === "dialog") {
      this.setSystem(SYS.dialogComplete, true);
      // 离开等待后清 clickable/noskip，防状态泄漏到后续非 say 命令
      this.setSystem(SYS.dialogClickable, false);
      this.setSystem(SYS.dialogNoskip, false);
      this.setSystem(SYS.waiting, "none");
      // say 的检查点在等待解除后提交（快照已在上屏时捕获 = 玩家所见画面）
      if (this.pendingSay !== null && !this.rollbackActive) {
        this.commitCheckpoint(this.pendingSay);
      }
      this.pendingSay = null;
      this.liveCheckpointed = false; // live 已越过检查点（后续等待点在 run 中自行改写）
      // voice auto_stop：玩家推进过该句 → 该句语音自动停止（互斥单槽）
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
          "当前 wait 不可跳过（仅 skipable 的 wait 可点击解除）",
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
      // cutscene 可跳过（skipable）→ 停视频并解除等待；不可跳 fail-closed
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

  /** choose = 解析 menu_targets 得序号 → `__menu_selected = idx`（fail-closed） */
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
        `未知选项目标：${optionId}（fail-closed）`,
      );
      return;
    }
    this.setSystem(SYS.menuSelected, idx);
    this.setSystem(SYS.waiting, "none");
    this.liveCheckpointed = false; // 选择改变画面：live 未入档（回退将落回菜单重选）
    // menu 选项目标 = columnId——选择即跳转（columnId 换、index 归零）
    if (!this.enterColumn(targets[idx] as string)) return;
    this.run();
  }

  /**
   * 会话命令 navigate：坐标切换（columnId 校验 fail-closed）——
   * UI/元素 nav 按钮与热重载重入的接缝。纯切换不建检查点（与 op navigate 的
   * 叙事节点检查点相区分；壳层导航不建 DSL 检查点，同语义）。
   */
  navigate(columnId: string): void {
    if (!this.started) {
      this.fail("navigate-invalid", "故事尚未启动");
      return;
    }
    this.flushPendingCheckpoint(); // 离开当前画面：已上屏未入档的 say 即所见
    this.clearTimer(); // 打断任意等待（wait 定时器废弃，等待画面由新列重建）
    this.abortMinigame(); // 导航打断小游戏：abort 挂载信号（等待期可回溯同语义）
    this.waitSkipable = false;
    this.liveCheckpointed = false;
    this.setSystem(SYS.waiting, "none");
    this.setSystem(SYS.currentDialogText, ""); // 清旧对话镜像（导航清屏）
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
    this.setSystem(SYS.dialogComplete, false);
    if (!this.enterColumn(columnId)) return;
    this.run();
  }

  /**
   * 会话命令 save：编排写档（载荷编排在 TS，加密与安全校验在 Rust）。
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
   * 会话命令 load：读档 → importSave（成功即传送到档内等待点；
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
   * setLanguage：切换当前语言（整表重建——
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
      // 默认语言或未装配端口：无译文表 = 原文直出（缺省；语言状态照记供 UI 观察）
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
    this.overlay = mergeOverlayFiles(files); // 整表重建 = 清缓存再载入
    this.setSystem(SYS.currentLanguage, lang);
  }

  /** 释放挂起定时器（UI 卸载/测试收尾）；监听器退订走 onXxx 返回的函数 */
  dispose(): void {
    this.clearTimer();
    this.abortMinigame(); // 挂载 signal abort → UI 卸载小游戏
    this.waitSkipable = false;
  }

  /**
   * 会话命令 resolveMinigame：UI 小游戏完成后回填结果（命令面）。
   * success → 奖励写状态（走 ValueChanged 事件流，历史可溯）→ on_success 分流；
   * fail → on_fail 分流；目标缺省 = 原列继续。非等待期/畸形结果 fail-closed。
   */
  // —— 元素系统公共接缝（UI 侧交互与宿主扩展经此接入） ——

  /** 当前舞台元素（只读；核心层所有元素写入都经 `SYS.elements`，随快照/存档/回溯） */
  elements(): ElementInstance[] {
    const value = this.state.get(SYS.elements);
    return Array.isArray(value) ? (value as ElementInstance[]) : [];
  }

  /**
   * 元素寻址：`id` 精确匹配优先，未命中再 `name` 批量匹配（递归含 children）。
   * 未命中返回空数组 —— 调用方 fail-closed（不静默、不伪造目标）。
   */
  findElements(target: string): ElementInstance[] {
    return findElementsIn(this.elements(), target);
  }

  /**
   * 表达式插值公开接缝：宿主侧文本（如元素 `cmd` 的 `value`）按**点击时**求值，
   * 取最新变量（点击时求值）。
   * 失败保留原文并出站 `engine.error`（不静默吞错）。
   */
  interpolate(source: string): string {
    if (typeof source !== "string" || source === "") return "";
    const { text, errors } = interpolateText(
      source,
      this.resolveName,
      this.draw,
    );
    for (const e of errors)
      this.fail(e.code, `插值失败（保留原文）：${e.message}`);
    return text;
  }

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
        this.setGlobal(entry.key, entry.value); // 奖励即状态变更（历史可溯）
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

  /** 回溯联动：中断小游戏等待 = abort 挂载信号（UI 卸载），重放到该坐标重新挂载 */
  private abortMinigame(): void {
    if (this.minigameController !== null) {
      this.minigameController.abort();
      this.minigameController = null;
    }
    this.pendingMinigame = null;
  }

  /**
   * 全局层写入（作者 `set`/`define` / 小游戏奖励 / 数组族 op 的唯一汇聚点）。
   *
   * 写入契约（fail-closed，拒绝时**状态原样**）：
   * - **键**：保留键（`RESERVED_STATE_KEYS` = SYS 精确名全集）拒绝（`reserved-key`）——
   *   SYS 键归引擎所有，外部写入会破坏等待状态机/回溯；
   * - **值**：JSON 安全（白名单 + 对新值深走查拒循环引用，带定位）（`value-not-serializable`）。
   */
  private setGlobal(key: string, value: unknown): void {
    if (RESERVED_STATE_KEYS.has(key)) {
      this.fail(
        "reserved-key",
        `保留键不可写入：${key}（SYS 全集为引擎所有；作者/扩展请改用其他键名）`,
      );
      return;
    }
    const unsafe = findJsonValueError(value, key);
    if (unsafe !== null) {
      this.fail(
        "value-not-serializable",
        `值不可序列化，写入被拒绝：${unsafe}（状态原样；请只写 JSON 安全值并按写时复制更新）`,
      );
      return;
    }
    this.state.set(key, value);
    this.emit(key, value, "global");
  }

  /**
   * 系统层写入（引擎内部专用，`SYS` 键的所有者）。
   * 值契约同样适用（引擎内部违约 = 引擎 bug，同样 fail-closed 暴露）；
   * 键不受保留键约束——`setSystem` 本来就是写 SYS 键的通道。
   */
  private setSystem(key: string, value: unknown): void {    const unsafe = findJsonValueError(value, key);
    if (unsafe !== null) {
      this.fail(
        "value-not-serializable",
        `系统键写入值不可序列化：${unsafe}（引擎内部契约违约）`,
      );
      return;
    }
    this.state.set(key, value);
    this.emit(key, value, "system");
  }

  /**
   * 实例级 z 的**执行期防御**（解析期 `format.ts` 已拒；这里是纵深防御）：
   * 非法（负数 / NaN / Infinity / 非数字）→ `engine.error` 且**不动任何状态**，调用方立即 return。
   * 返回 `true` = 已拒绝（调用方必须 `return`）。
   */
  private rejectBadInstanceZ(cmd: StoryCommand): boolean {
    if (cmd.z === undefined) return false;
    if (typeof cmd.z === "number" && Number.isFinite(cmd.z) && cmd.z >= 0) {
      return false;
    }
    this.fail(
      "instance-z-invalid",
      `实例级 z 必须为非负有限数，收到 ${String(cmd.z)}`,
    );
    return true;
  }

  /**
   * 实例级 z：把命令上的 `z` 写进 SSOT（键 ↔ 层见 `INSTANCE_Z_KEYS`）。
   *
   * - **有值**（非负有限数）→ `setSystem`（进事件流，宿主据此改该层 z）；
   * - **缺省/非法** → **删除键**（回层默认）并广播 `undefined` —— 保证「不带 z 的下一条命令」
   *   不会沿用上一条的覆盖（这正是「只影响这一个，不影响其他 say」的要求）。
   *
   * 进 SSOT 的收益：随快照 / 存档 / 回溯自动随行（重放到同一条命令重新写入同一值）。
   * 前置：调用方已用 `rejectBadInstanceZ` 拒掉非法值。
   */
  private setInstanceZ(key: string, raw: unknown): void {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      this.setSystem(key, raw);
      return;
    }
    if (this.state.delete(key)) this.emit(key, undefined, "system");
  }

  private emit(key: string, value: unknown, scope: string): void {
    const change: ValueChanged = { key, value, scope };
    for (const listener of this.stateListeners) listener(change);
  }

  /** 出站事件统一发射：信封 `{v,kind:'event',payload}` + 广播全体监听者 */
  private emitEvent(payload: OutboundPayload): void {
    const event: OutboundEvent = { v: 1, kind: "event", payload };
    for (const listener of this.eventListeners) listener(event);
  }

  /** engine.error 事件出站，绝不静默 */
  private fail(code: string, message: string): void {
    this.emitEvent({
      kind: "engine.error",
      code,
      message,
      coordinate: { ...this.coord },
    });
  }

  /**
   * 扩展 op 执行（fail-closed）。成功 = 推进（分发表前置分支负责步进）；
   * 失败（exec 返回非 ok 或抛出被 runRegisteredOp 兜底）= engine.error + 停在当前命令。
   * 副作用只经 ExtensionContext（物理强制 `ext.<id>.` 前缀）→ 状态进 SSOT。
   */
  private execExtensionOp(entry: RegisteredOp, cmd: StoryCommand): boolean {
    this.usedExtensions.add(entry.extensionId); // 实际执行过 → 存档依赖标记
    const outcome = runRegisteredOp(entry, cmd, this.story, {
      get: (key) => this.get(key),
      setGlobal: (key, value) => this.setGlobal(key, value),
    });
    if (outcome.ok) return true;
    this.fail(outcome.code, outcome.message);
    return false;
  }

  /**
   * Translate：命中即用译文（含空串译文），未命中/
   * 无 overlay 回退原文；空原文直返。调用点必须**先于插值**——overlay 键可含 {var} 占位符
   * （插值在译文上进行）。
   */
  private translate(original: string): string {
    if (original === "" || this.overlay === null) return original;
    const hit = this.overlay.get(original);
    return hit === undefined ? original : hit;
  }

  /**
   * 翻译面覆盖所有展示文字：元素展示文字（`text` 属性）
   * 在**装载时**翻译——进 SSOT 的即译文（随快照/存档/回溯随行）；切换语言后当前画面不重翻
   * （与 menu 挂接同语义：下次 Translate 生效），再次进列重新装载时生效。递归 children。
   * 无 `text` 的元素原样返回（引用不变，不触发无谓的 ValueChanged 噪声之外的对象复制）。
   */
  private translateElements(
    instances: readonly ElementInstance[],
  ): ElementInstance[] {
    return instances.map((instance) => {
      const raw = instance.props.text;
      const props =
        typeof raw === "string"
          ? { ...instance.props, text: this.translate(raw) }
          : instance.props;
      return {
        ...instance,
        props,
        children: this.translateElements(instance.children ?? []),
      };
    });
  }

  private columnById(id: string): StoryColumn | undefined {
    return this.story.columns.find((c) => c.id === id);
  }

  /**
   * 找到「最后一个可回溯坐标」的历史游标（菜单态存档时用）。
   *
   * 为什么需要：菜单期间**不建检查点**（见 `commitCheckpoint` 守卫），
   * 但 `cursor` 仍可能停在菜单之前那个坐标上——直接用它会把菜单产生的
   * **前向时间线截断**语义带进档里。取「最后一个坐标属可回溯列」的检查点，
   * 保证档里的历史**只含玩家真正走过的游戏步骤**。
   *
   * 找不到（历史为空/全在菜单列）⇒ 返回 `null`（调用方按「无历史」处理）。
   */
  private lastReplayableCursor(): number | null {
    for (let i = Math.min(this.cursor, this.history.length - 1); i >= 0; i -= 1) {
      const cp = this.history[i];
      if (cp === undefined) continue;
      const column = this.columnById(cp.coord.columnId);
      if (column !== undefined && isReplayableColumn(column)) return i;
    }
    return null;
  }

  /**
   * 当前列是否参与历史/存档（`type` 缺省 = game ⇒ 参与）。
   *
   * **单一判定点**：`isReplayableColumn` 来自契约，引擎守卫与编辑器分组
   * 共用它——**不各写一份**（两份判据必然漂移）。
   */
  private isCurrentColumnReplayable(): boolean {
    const columnId = this.coord.columnId;
    if (columnId === "") return true; // 尚未进入任何列（启动期）⇒ 视为可回溯
    const column = this.columnById(columnId);
    // 列不存在（热重载后坐标失效等）⇒ **不拦**（保持既有行为：让流程自己 fail-closed 报错）
    if (column === undefined) return true;
    return isReplayableColumn(column);
  }

  /** 进入列：替换整个帧栈（出块/出列销毁作用域），建列级作用域，坐标归零 */
  private enterColumn(columnId: string): boolean {
    const column = this.columnById(columnId);
    if (column === undefined) {
      this.fail(
        "unknown-column",
        `目标列不存在：${columnId}`,
      );
      return false;
    }
    // 场景类型分流：
    // 进入 menu/ui 列 ⇒ 记下**进入前**的可回溯坐标与等待态（`__menu_return`），
    // 供「在菜单里存档」时还原成菜单前的游戏进度（Ren'Py Esc 菜单存档语义）。
    // 必须在改 `this.coord` **之前**取旧值。
    if (!isReplayableColumn(column)) {
      const prevColumnId = this.coord.columnId;
      const prevColumn = this.columnById(prevColumnId);
      // 只有「从可回溯列进入菜单」才记（菜单→菜单导航不覆盖上一个游戏点，
      // 否则连开两个菜单会把游戏点写坏）
      if (prevColumn !== undefined && isReplayableColumn(prevColumn)) {
        this.setSystem(SYS.menuReturn, {
          coord: { columnId: prevColumnId, index: this.coord.index },
          waiting: this.get(SYS.waiting) ?? "none",
        });
      }
    }
    this.coord = { columnId, index: 0 };
    this.setSystem(SYS.currentSceneColumn, columnId);
    // 返回 game 列 ⇒ **清掉**菜单记账（已经回到游戏里）。
    // **只在真的有记账时才写**：空串是缺省值，无条件写会给每次进列都多一次
    // `ValueChanged`（「键序列精确匹配」测试会正确地撞红）。
    if (isReplayableColumn(column) && parseMenuReturn(this.get(SYS.menuReturn)) !== null) {
      this.setSystem(SYS.menuReturn, "");
    }
    // 空间层：scene 列的元素是**声明式装载**（不进命令流），entry 才是进入后
    // 按序执行的命令流；列切换整体替换 __elements（空间层属于列），回溯由快照还原。
    this.setSystem(
      SYS.elements,
      column.kind === "scene"
        ? this.translateElements(loadElements(column.elements ?? [], columnId))
        : [],
    );
    this.frames = [
      {
        columnId,
        commands:
          column.kind === "flow" ? column.commands! : (column.entry ?? []),
        index: 0,
        scope: Scope.root(), // 列级作用域
      },
    ];
    return true;
  }

  /** 逐命令解释执行：取命令 → 执行 → 前进；遇等待点即停（调用方保证 __waiting=none） */
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
        this.frames.pop(); // 出块/出列：块级作用域随之不可达
        continue;
      }
      const cmd = frame.commands[frame.index]!;
      // 扩展查找前置：内建 switch 一行不动 ⇒ 内建行为逐字节等价；
      // 扩展 op 的推进语义 = 执行成功即步进（v1 无等待态）
      const extensionOp = this.extensionOps.get(cmd.op);
      if (extensionOp !== undefined) {
        if (!this.execExtensionOp(extensionOp, cmd)) return;
        frame.index += 1;
        continue;
      }
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
        case "assert":
          if (!this.execAssert(cmd)) return; // 拦截 = 停在当前命令（状态原样 + 不推进）
          frame.index += 1;
          continue;
        case "guard":
          if (!this.execGuard(cmd)) return; // 拦截 = 停在当前命令（状态原样 + 不推进）
          frame.index += 1;
          continue;
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
        case "show":
        case "hide":
        case "background":
        case "bg_switch":
        case "zindex":
        case "style":
          // 元素增删改：非阻塞（写 SYS.elements，随快照/回溯），故事继续
          if (!this.execElementVisual(cmd)) return;
          frame.index += 1;
          continue;
        case "window":
          // 对话框显隐三态（写 SYS.dialogVisible，UI 据此控层）
          if (!this.execWindow(cmd)) return;
          frame.index += 1;
          continue;
        case "animate":
        case "animate_block":
          // 元素动画：核心只写动画描述（UI 每帧插值，播毕回调写回终值）
          if (!this.execAnimate(cmd)) return;
          frame.index += 1;
          continue;
        case "transition":
        case "shake":
          // 屏幕级效果：写启动键（UI 帧驱动，播毕回调清除）
          if (!this.execScreenEffect(cmd)) return;
          frame.index += 1;
          continue;
        case "text_typewriter":
          // 故事级打字机设置（玩家偏好可覆盖）
          if (!this.execTextTypewriter(cmd)) return;
          frame.index += 1;
          continue;
        default:
          // fail-closed：未知/未实现 op 不静默跳过
          this.fail("unknown-op", `未知或未实现的命令：${cmd.op}`);
          return;
      }
    }
  }

  /** say：写对话系统键 → 进入 dialog 等待（文本先翻译后插值） */
  private execSay(frame: Frame, cmd: StoryCommand): void {
    if (this.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
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
    // `say color` 校验：**hex 格式，fail-closed**。
    // 与编辑器 schema 同一判据（`isValidSayColor`）⇒ 杜绝「投影层放宽、校验层拒绝」
    // 这类两处漂移（同一功能两个口径是最忌的）。
    if (cmd.color !== undefined && !isValidSayColor(cmd.color)) {
      this.fail(
        "say-invalid-color",
        `say.color 必须为十六进制颜色（如 "#FFD700" / "#888" / "#FFD700CC"），收到 ${JSON.stringify(cmd.color)}`,
      );
      return;
    }
    // 先 Translate 后插值（overlay 键可含 {var} 占位符）+ {var:00} 格式化（仅文本命令）；
    // 行内标记 {b}{p} 原样透传；失败保留原文 + error
    // speaker 与 text 同语义插值——动态说话人（如 func 实参）经此获得真实名字；
    // 说话人**显示名**同样走 Translate（翻译面覆盖所有展示文字）；
    // 角色模板查表仍用插值后的原值。
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

    // 竞态防护：进入等待前清上一句残留的完成标记（防双击/快速点击跳句）
    this.setSystem(SYS.dialogComplete, false);
    this.setSystem(SYS.currentDialogSpeaker, this.translate(speakerText));
    // 说话人颜色覆盖（`say color="#888"`）：**每句都写**——
    // 缺省写空串 ⇒ 上一句的覆盖不会残留（与 `currentDialogSpeaker` 同一口径）。
    // UI 读法：`覆盖值 || character.color`（覆盖优先于角色定义）。
    this.setSystem(
      SYS.currentDialogColor,
      typeof cmd.color === "string" ? cmd.color : "",
    );
    // 模板三级优先级：
    // say template > character screen（按插值后说话人查表，与 UI 侧角色样式查表一致）> null(全局默认)
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
    this.setInstanceZ(SYS.dialogueZ, cmd.z); // 本句的实例 z（仅影响这一句）
    // NVL 激活时当前句追加进累积缓冲（新引用，观察者可感知；随状态快照走）
    // 重放期不追加——buffer 已由快照恢复，重放只重建当前对话键
    if (this.get(SYS.nvlMode) === "active" && !this.rollbackActive) {
      const buffer = this.get(SYS.nvlBuffer);
      this.setSystem(SYS.nvlBuffer, [
        ...(Array.isArray(buffer) ? (buffer as string[]) : []),
        text,
      ]);
    }
    this.setSystem(SYS.waiting, "dialog");
    // say 的 voice 参数绑定本句语音进 voice 通道（auto_stop 默认 true → 推进过该句即停）
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
    // 快照在上屏时刻捕获（= 玩家所见画面，帧栈定位在本等待命令上），等待解除后才提交入档。
    // 重放期同样捕获：同坐标提交由 commitCheckpoint 原位替换（幂等），历史在回溯/读档路径上自愈完整
    this.pendingSay = this.takeSnapshot(this.checkpointCoord(frame));
    this.autoSaveAtCheckpoint(); // say 等待画面建立 = 玩家所见稳定点，auto_save 开关消费
    // 坐标推进：say 进入等待即前移，坐标恒指「下一待执行命令」——检查点在玩家所见之后
    frame.index += 1;
  }

  /**
   * 检查点/存档坐标恒指「能重放重建本等待点」的列内顶层位置。
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
   * navigate op：跨列导航。目标列 = scene ?? path（scene 优先），
   * 二者都是 columnId（列名即标签，「文件」在组装模型中坍缩为列）。
   * 与 jump 的语义差异 = 清旧列对话镜像（导航 = 画面边界）+
   * path/scene 词汇（JSON v1 契约）。**不建检查点**：navigate
   * 建检查点的语义在检查点模型下产生回溯陷阱——导航站重放必重建下一站的等待画面，
   * flush 提交命中前向同坐标站使 cursor 前移，back 原地循环；检查点 = 玩家所见，
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
    this.setSystem(SYS.currentDialogText, ""); // 清旧列对话镜像（导航 = 画面边界）
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
    this.setSystem(SYS.dialogComplete, false);
    return this.enterColumn(target);
  }

  /**
   * save op：声明存档点——载荷落到**下一玩家所见等待画面**（存档坐标
   * 必须是可重放重建的等待点；「命令位置快照」与此不同构，重放侧效即由此规避）。
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

  /** load op：读档传送（复用会话命令 load；异步 importSave 后即传送） */
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
   * auto_save op：开关系统键 `__auto_save`（编译期与 set 同语义）。
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

  /** save_delete op：删除槽位（异步 kick；删档不动高水位——防回档基准不随删档回退） */
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

  /** menu：写菜单系统键 → 进入 menu 等待（清对话残留） */
  private execMenu(frame: Frame, cmd: StoryCommand): void {
    if (this.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
    const options = cmd.options as Array<{ text: string; target: string }>; // 解析器已验证结构
    this.setSystem(SYS.currentDialogText, "");
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
    // prompt/选项文案先 Translate（目标列名不翻译——menuTargets 原样）
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
    this.setInstanceZ(SYS.choicesZ, cmd.z); // 本次菜单的实例 z（choices 层）
    this.setSystem(SYS.waiting, "menu");
    // 菜单展示时建检查点（展示中 live == 检查点，回退落回菜单重选）；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    this.autoSaveAtCheckpoint(); // 菜单等待画面建立 = auto_save 消费点
    frame.index += 1;
  }

  /** wait/pause（wait 可 skipable、pause=hard；seconds 必填） */
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
    // wait 检查点在等待建立时；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    this.autoSaveAtCheckpoint(); // wait 等待画面建立 = auto_save 消费点
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

  /** if/elif/else：条件执行期求值；分支体 = 块帧 + 块级作用域 */
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
      scope: frame.scope.enterChild(), // 块级作用域：出块销毁
    });
    return true;
  }

  /**
   * assert：断言校验（fail-closed 拦截语义）。
   * cond 求值为假 ⇒ `engine.error`（code = assert-failed）+ **停在当前命令**
   * （状态原样、不推进——作者可用重写源/数据修正后重放；重放同位同判 = 回溯安全）。
   * 为真 = 纯推进（无副作用、不产系统键 ⇒ 键序列与既有测试零冲突）。
   */
  private execAssert(cmd: StoryCommand): boolean {
    const cond = this.evalCond(cmd.cond);
    if (cond === null) return false; // 表达式求值错误（fail 已在 evalCond 内出站）
    if (cond) return true;
    const message =
      typeof cmd.message === "string" && cmd.message !== ""
        ? cmd.message
        : String(cmd.cond ?? "");
    this.fail("assert-failed", `断言失败：${message}`);
    return false;
  }

  /**
   * guard：运行期守卫（组合根注册制）。
   * 未注册名 / args 非 JSON 安全 / ctx.fail / 抛出 ⇒ engine.error + **停在当前命令**
   * （状态原样 + 阻止推进）。通过 = 纯推进。守卫不改状态（ctx 无 set——职责分离）。
   */
  private execGuard(cmd: StoryCommand): boolean {
    const name = typeof cmd.fn === "string" ? cmd.fn : "";
    const guard = this.guards[name];
    if (guard === undefined) {
      this.fail("guard-unknown", `未注册的守卫：${name === "" ? "(空)" : name}`);
      return false;
    }
    const args = (cmd.args ?? {}) as Record<string, unknown>;
    const unsafe = findJsonValueError(args, "args"); // 故事数据来的参数必须 JSON 安全
    if (unsafe !== null) {
      this.fail("guard-args-unsafe", `守卫 ${name} 参数非 JSON 安全：${unsafe}`);
      return false;
    }
    const ctx: GuardContext = {
      get: (key) => this.get(key),
      fail: (message) => {
        throw new GuardFailure(message);
      },
    };
    try {
      guard(ctx, args);
      return true;
    } catch (error) {
      if (error instanceof GuardFailure) {
        this.fail("guard-failed", error.message);
      } else {
        this.fail(
          "guard-threw",
          `守卫 ${name} 抛出：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  /** while：条件执行期求值；body = 循环帧（每轮重判条件） */
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

  /** for：`in` 表达式执行期求值 → 必须为数组，逐元素迭代 */
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

  /** foreach：key 为集合变量名（foreach "v" in "k"，编译为 for 同构） */
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

  /** for/foreach 同构：物化数组 → 循环帧逐元素推进；循环变量 = 块级局部 */
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

  /** 开始一轮迭代：每轮新块作用域，声明循环变量，游标归零；超上限 fail-closed */
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

  /** switch：编译为 if/else 链——case 字面量相等比较，命中即走、不穿透 */
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

  /** 条件求值：{...} 包裹按约定剥离；结果必须 boolean；任何失败 → engine.error + 停机 */
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
   * set/let/local：
   * - set：写入声明时所在层，未声明 → 全局（SSOT Map）；支持 += 等复合赋值
   * - let/local：块级可变，声明进当前最内层作用域
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
          throw new ExpressionError("division-by-zero", "'/=' 除数为 0");
        return current / rhs;
      default:
        if (rhs === 0)
          throw new ExpressionError("division-by-zero", "'%=' 除数为 0");
        return current % rhs;
    }
  }

  /** define：全局 + once——不存在才设 */
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

  /** undef：销毁声明槽；沿块/列作用域链与全局层查找 */
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

  /** array：key + items[]（项可为 {expr}）；once → 已存在跳过 */
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

  /** dict：value 为 JSON 对象字面量（字段值可为 {expr}）；once 同 array */
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

  /** NVL：进入/清屏/退出累积层；累积文本进核心状态（回溯/存档自动一致） */
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

  /** character：注册/更新角色定义（可覆盖更新） */
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

  /** 查询角色定义（UI 渲染 say speaker 时套用） */
  getCharacter(key: string): CharacterDef | undefined {
    return this.characters.get(key);
  }

  getCharacters(): CharacterDef[] {
    return [...this.characters.values()];
  }

  /**
   * 四音频通道：核心只写状态，播放由 UI 适配器落地。
   * - bgm/ambient/voice 为常驻通道（写状态对象，随快照/存档随行）；se 为一次性触发（单调 seq）
   * - 同资源重写保留播放位置：重放不打断当前曲目（回滚 seek / 读档续播）
   * - stop_* 写 stop 形态（带淡出参数）；未知字段/非法负载 fail-closed
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
      // 停止背景乐：播放位置归零（帧级键静默写）
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
      // 首播/换曲/显式重播归零；同曲静默续播（回滚 seek / 读档续播）。
      // 帧级键静默写（高频键不进事件流），UI 经通道事件重读位置。
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
   * 视频族：核心只写命令流（`__video`，seq 单调），渲染器按序执行。
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
      if (this.rejectBadInstanceZ(cmd)) return false; // 先拒非法 z（不动状态）
      this.setInstanceZ(SYS.videoZ, cmd.z); // 视频层实例 z（宿主解析后交 VideoPort.setZIndex）
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
        // 过场等待建立时提交检查点（同 menu/wait/input）；重放期同坐标原位替换
        this.setSystem(SYS.waiting, "video");
        this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
        this.liveCheckpointed = true;
        this.autoSaveAtCheckpoint(); // cutscene 等待画面建立 = auto_save 消费点
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
   * 元素增删（`show` / `hide` / `background` / `bg_switch`）：统一进**同一元素表**
   * `SYS.elements`（纯数据，随快照/存档/回溯自动随行）。
   *
   * - `show`：追加元素；`background=true` 先清旧背景并固定底层序（`BACKGROUND_Z`）
   * - `hide`：按 `id`/`name`/`source` 移除，递归含 children；未命中**幂等不报错**
   * - `background` / `bg_switch`：换背景（先清旧背景 → 追加，固定底层序）
   */
  private execElementVisual(cmd: StoryCommand): boolean {
    const known = ELEMENT_OP_FIELDS[cmd.op]!;
    const unknown = Object.keys(cmd).filter((k) => !known.has(k));
    if (unknown.length > 0) {
      this.fail(
        `${cmd.op}-unknown-field`,
        `${cmd.op} 未知负载字段：${unknown.join(", ")}`,
      );
      return false;
    }
    const current = this.elements();

    if (cmd.op === "hide") {
      const target = typeof cmd.target === "string" ? cmd.target : "";
      if (target === "") {
        this.fail(
          "hide-invalid",
          "hide.target 必须为非空目标（id / name / source 任一）",
        );
        return false;
      }
      this.setSystem(SYS.elements, removeElements(current, target).next);
      return true;
    }

    if (cmd.op === "show") {
      const target = typeof cmd.target === "string" ? cmd.target : "";
      if (target === "") {
        this.fail("show-invalid", "show.target 必须为非空资源路径（写入 source）");
        return false;
      }
      for (const key of ["x", "y"] as const) {
        const value = cmd[key];
        if (
          value !== undefined &&
          typeof value !== "number" &&
          typeof value !== "string"
        ) {
          this.fail(
            "show-invalid",
            `show.${key} 必须为数字或字符串（CSS 长度）`,
          );
          return false;
        }
      }
      return this.appendElement(current, target, {
        isBackground: cmd.background === true,
        id: typeof cmd.id === "string" && cmd.id !== "" ? cmd.id : undefined,
        name:
          typeof cmd.name === "string" && cmd.name !== "" ? cmd.name : undefined,
        x: cmd.x,
        y: cmd.y,
      });
    }

    if (cmd.op === "zindex") {
      const target = typeof cmd.target === "string" ? cmd.target : "";
      const value = cmd.value;
      if (target === "" || typeof value !== "number" || !Number.isFinite(value)) {
        this.fail(
          "zindex-invalid",
          "zindex 需要 target（非空）与 value（有限数字）",
        );
        return false;
      }
      const hits = this.findElements(target);
      if (hits.length === 0) {
        this.fail("zindex-target-not-found", `zindex 未命中任何元素：${target}`);
        return false;
      }
      this.setSystem(
        SYS.elements,
        this.mapElements((el) => (hits.includes(el) ? { ...el, z: value } : el)),
      );
      return true;
    }

    if (cmd.op === "style") {
      const target = typeof cmd.target === "string" ? cmd.target : "";
      const raw = cmd.props;
      if (
        target === "" ||
        raw === null ||
        typeof raw !== "object" ||
        Array.isArray(raw)
      ) {
        this.fail("style-invalid", "style 需要 target（非空）与 props（对象）");
        return false;
      }
      const styleProps = raw as Record<string, unknown>;
      // 样式键必须在元素属性全集内（未知属性 fail-closed）
      const unknown = Object.keys(styleProps).filter(
        (k) => !ELEMENT_ATTRIBUTES.has(k),
      );
      if (unknown.length > 0) {
        this.fail(
          "style-unknown-attr",
          `style 未知元素属性：${unknown.join(", ")}`,
        );
        return false;
      }
      const hits = this.findElements(target);
      if (hits.length === 0) {
        this.fail("style-target-not-found", `style 未命中任何元素：${target}`);
        return false;
      }
      this.setSystem(
        SYS.elements,
        this.mapElements((el) =>
          hits.includes(el)
            ? { ...el, props: { ...el.props, ...styleProps } }
            : el,
        ),
      );
      return true;
    }

    // background / bg_switch：换背景
    const resource = typeof cmd.resource === "string" ? cmd.resource : "";
    if (resource === "") {
      this.fail(`${cmd.op}-invalid`, `${cmd.op}.resource 必须为非空资源路径`);
      return false;
    }
    return this.appendElement(current, resource, { isBackground: true });
  }

  /**
   * 元素表递归映射（含 children）。命中判定按**引用**：寻址结果与 `this.elements()`
   * 同源同引用，故 `hits.includes(el)` 即可精确命中（无需按 id 反查，避免派生 id 重名歧义）。
   */
  private mapElements(
    mapper: (el: ElementInstance) => ElementInstance,
  ): ElementInstance[] {
    const walk = (list: readonly ElementInstance[]): ElementInstance[] =>
      list.map((el) => {
        const mapped = mapper(el);
        if (mapped.children.length === 0) return mapped;
        return { ...mapped, children: walk(mapped.children) };
      });
    return walk(this.elements());
  }

  /**
   * 对话框显隐三态：`auto`（跟随对话态，默认）| `show`（强制显示）| `hide`（强制隐藏）。
   * 只写状态；DOM 可见性归 UI 层（核心只写状态）。
   */
  private execWindow(cmd: StoryCommand): boolean {
    const mode = cmd.mode;
    if (mode !== "auto" && mode !== "show" && mode !== "hide") {
      this.fail(
        "window-invalid",
        'window.mode 必须为 "auto" | "show" | "hide"',
      );
      return false;
    }
    this.setSystem(SYS.dialogVisible, mode);
    return true;
  }

  /**
   * 元素动画（`animate` / `animate_block`）：核心只写**动画描述**进 `SYS.animations`，
   * UI 每帧插值，播毕调 `animationFinished(seq)` 写回终值。
   *
   * - `from` 取目标元素当前属性值；非有限数字或未设 = `0`
   * - `animate_block` 的多个属性**并行**（同 duration）：JSON 键序对作者不可控，序列语义请用多条
   *   `animate` 表达（有意差异：不做序列执行）
   */
  private execAnimate(cmd: StoryCommand): boolean {
    const target = typeof cmd.target === "string" ? cmd.target : "";
    if (target === "") {
      this.fail(`${cmd.op}-invalid`, `${cmd.op}.target 必须为非空目标`);
      return false;
    }
    const hits = this.findElements(target);
    if (hits.length === 0) {
      this.fail(
        `${cmd.op}-target-not-found`,
        `${cmd.op} 未命中任何元素：${target}`,
      );
      return false;
    }
    const element = hits[0]!;
    const duration =
      typeof cmd.duration === "number" &&
      Number.isFinite(cmd.duration) &&
      cmd.duration >= 0
        ? cmd.duration
        : 0.3;
    const easing =
      typeof cmd.easing === "string" && cmd.easing !== ""
        ? cmd.easing
        : "EaseOutQuad";

    if (cmd.op === "animate") {
      const property = typeof cmd.property === "string" ? cmd.property : "";
      const value = cmd.value;
      if (
        property === "" ||
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        this.fail(
          "animate-invalid",
          "animate 需要 property（非空）与 value（有限数字）",
        );
        return false;
      }
      const spec = this.makeAnimation(element, property, value, duration, easing);
      this.setSystem(SYS.animations, [...this.animations(), spec]);
      return true;
    }

    // animate_block：多属性同时开始
    const specs: AnimationSpec[] = [];
    for (const property of ANIMATE_BLOCK_PROPS) {
      const value = cmd[property];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        this.fail(
          "animate_block-invalid",
          `animate_block.${property} 必须为有限数字`,
        );
        return false;
      }
      specs.push(this.makeAnimation(element, property, value, duration, easing));
    }
    if (specs.length === 0) {
      this.fail(
        "animate_block-invalid",
        "animate_block 至少需要一个属性（x / y / opacity / rotation / scale）",
      );
      return false;
    }
    this.setSystem(SYS.animations, [...this.animations(), ...specs]);
    return true;
  }

  /** 构造动画描述（`from` 取元素当前值，缺省 0）；`target` 固化为元素 id，避免回溯后寻址漂移 */
  private makeAnimation(
    element: ElementInstance,
    property: string,
    to: number,
    duration: number,
    easing: string,
  ): AnimationSpec {
    const raw = element.props[property];
    const from = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    this.animationSeq += 1;
    return {
      target: element.id,
      property,
      from,
      to,
      duration,
      easing,
      seq: this.animationSeq,
    };
  }

  /** —— 帧驱动消费侧接缝（UI 每帧读取 / 播毕回调）—— */

  /** 动画队列（UI 每帧按 elapsed 插值应用到 DOM，不逐帧写 SSOT） */
  animations(): AnimationSpec[] {
    const value = this.state.get(SYS.animations);
    return Array.isArray(value) ? (value as AnimationSpec[]) : [];
  }

  /**
   * 动画播毕（UI 回调）：终值写回元素 `props` 并移除条目 ——
   * 使快照 / 存档 / 回溯看到的是**终态**而非中间值。
   */
  animationFinished(seq: number): void {
    const list = this.animations();
    const done = list.filter((a) => a.seq === seq);
    if (done.length === 0) return;
    this.setSystem(
      SYS.animations,
      list.filter((a) => a.seq !== seq),
    );
    this.setSystem(
      SYS.elements,
      this.mapElements((el) => {
        const settle = done.filter((a) => a.target === el.id);
        if (settle.length === 0) return el;
        const props = { ...el.props };
        for (const a of settle) props[a.property] = a.to;
        return { ...el, props };
      }),
    );
  }

  /**
   * 屏幕级效果启动：
   * - `transition { type, duration }` → `SYS.transition`（UI 全屏遮罩动画）
   * - `shake { intensity, duration }` → `SYS.shake`（UI 抖动偏移）
   */
  private execScreenEffect(cmd: StoryCommand): boolean {
    const duration =
      typeof cmd.duration === "number" &&
      Number.isFinite(cmd.duration) &&
      cmd.duration >= 0
        ? cmd.duration
        : 0.5;
    if (cmd.op === "transition") {
      const type = typeof cmd.type === "string" ? cmd.type : "";
      if (type === "") {
        this.fail(
          "transition-invalid",
          "transition.type 必须为非空效果名",
        );
        return false;
      }
      this.transitionSeq += 1;
      this.setSystem(SYS.transition, {
        type,
        duration,
        seq: this.transitionSeq,
      });
      return true;
    }
    const intensity =
      typeof cmd.intensity === "number" && Number.isFinite(cmd.intensity)
        ? cmd.intensity
        : 8;
    this.shakeSeq += 1;
    this.setSystem(SYS.shake, {
      intensity,
      duration,
      seq: this.shakeSeq,
    });
    return true;
  }

  /** 转场播毕（UI 回调）：清除启动键 */
  transitionFinished(): void {
    this.setSystem(SYS.transition, null);
  }

  /** 震动播毕（UI 回调）：清除启动键 */
  shakeFinished(): void {
    this.setSystem(SYS.shake, null);
  }

  /**
   * 故事级打字机设置（`text_typewriter`）：`enabled`（开关）与/或
   * `speed`（字符/秒）。与玩家偏好（独立存储）分离——偏好优先级更高，由 UI 合成。
   */
  private execTextTypewriter(cmd: StoryCommand): boolean {
    const enabled = cmd.enabled;
    const speed = cmd.speed;
    if (enabled !== undefined && typeof enabled !== "boolean") {
      this.fail("text_typewriter-invalid", "text_typewriter.enabled 必须为布尔");
      return false;
    }
    if (
      speed !== undefined &&
      (typeof speed !== "number" || !Number.isFinite(speed) || speed <= 0)
    ) {
      this.fail(
        "text_typewriter-invalid",
        "text_typewriter.speed 必须为正数（字符/秒）",
      );
      return false;
    }
    if (enabled === undefined && speed === undefined) {
      this.fail(
        "text_typewriter-invalid",
        "text_typewriter 至少需要 enabled 或 speed",
      );
      return false;
    }
    const next: Record<string, unknown> = {};
    if (enabled !== undefined) next.enabled = enabled;
    if (speed !== undefined) next.speed = speed;
    this.setSystem(SYS.typewriter, next);
    return true;
  }

  /**
   * 追加元素到空间层（背景先清旧背景 + 固定底层序）。
   * `id` 缺省按**追加序**派生（确定性：同序重放得到同 id），显式 `id` 优先。
   */
  private appendElement(
    current: readonly ElementInstance[],
    source: string,
    options: {
      isBackground: boolean;
      id?: string;
      name?: string;
      x?: unknown;
      y?: unknown;
    },
  ): boolean {
    const base = options.isBackground
      ? current.filter((e) => e.type !== "background")
      : [...current];
    const props: Record<string, unknown> = { source };
    if (options.isBackground) {
      props.x = 0;
      props.y = 0;
    } else {
      if (options.x !== undefined) props.x = options.x;
      if (options.y !== undefined) props.y = options.y;
    }
    const element: ElementInstance = {
      id:
        options.id ??
        (options.isBackground ? "background" : `show#${base.length}`),
      type: options.isBackground ? "background" : "image",
      props,
      z: options.isBackground ? BACKGROUND_Z : base.length,
      children: [],
    };
    if (options.name !== undefined) element.name = options.name;
    base.push(element);
    this.setSystem(SYS.elements, base);
    return true;
  }

  /**
   * 过场完成（UI 播放结束回调）：解除 video 等待，故事继续。
   * 检查点已在过场建立时提交（重放不再重看）。
   */
  videoFinished(): void {
    if (this.get(SYS.waiting) !== "video") {
      this.fail("video-finish-invalid", "当前不在视频等待中");
      return;
    }
    // 过场结束即收起视频层（与「跳过」路径对称）：视频层实例 z 常高于对话层，
    // 不收起会继续盖住对话与 HUD（点击因 pointer-events:none 仍可穿透，界面看似卡死）
    this.videoSeq += 1;
    this.setSystem(SYS.video, {
      kind: "stop",
      seq: this.videoSeq,
    } satisfies VideoCommand);
    this.setSystem(SYS.waiting, "none");
    this.liveCheckpointed = false; // live 已越过该检查点
    this.run();
  }

  /**
   * 媒体位置帧级回写（UI 每帧轮询播放器）。
   * 帧级键静默写：不进事件流（防事件风暴）；随快照/存档持久化（读档续播）。
   */
  reportMediaPosition(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) return; // 播放器噪声值忽略
    this.state.set(SYS.bgmPosition, seconds);
  }

  /** notify：出站 toast 事件（覆盖层）；文本插值与 say 同语义 */
  private execNotify(cmd: StoryCommand): void {
    if (this.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
    const { text, errors } = interpolateText(
      this.translate(cmd.text as string),
      this.resolveName,
      this.draw,
    );
    for (const e of errors)
      this.fail(e.code, `插值失败（保留原文）：${e.message}`);
    this.setInstanceZ(SYS.notificationsZ, cmd.z); // 本条通知的实例 z（notifications 层）
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
   * minigame op：建立小游戏等待（同 menu/wait/input 建立检查点），
   * 发布挂载事件（signal 供回溯/中断卸载）。语义：reward.value 执行期求值
   * （支持 {expr}，重放经 rngState 恢复保持确定性）；on_success/on_fail 缺省 = 原列继续。
   */
  private execMinigame(frame: Frame, cmd: StoryCommand): void {
    if (this.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
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
    this.setInstanceZ(SYS.minigameZ, cmd.z); // 本次挂载的实例 z（minigame 层）
    this.setSystem(SYS.minigame, {
      game: cmd.game,
      config: (cmd.config ?? {}) as Record<string, unknown>,
      seq,
    });
    this.setSystem(SYS.waiting, "minigame");
    // 等待建立时提交检查点；重放期同坐标原位替换（重放重新挂载 = 新 seq 新 signal）
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    this.autoSaveAtCheckpoint(); // 小游戏等待画面建立 = auto_save 消费点
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

  /** func：执行期注册进函数表；重复注册 fail-closed（确定性重放重入同函数 = 幂等放行） */
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
   * call：按名查表 → 实参求值按位绑定 → 函数帧（体 = 独立块作用域）。
   * 未注册/参数个数不符 fail-closed。
   */
  private execCall(frame: Frame, cmd: StoryCommand): boolean {
    const name = cmd.target as string;
    const fn = this.functions.get(name);
    if (fn === undefined) {
      // **列（label）目标**：`call` 的文档语义是「调用子过程（**func 或 label**），
      // 用 return 返回」——只认 func 会让 `call sb_subroutine`
      // （`label sb_subroutine:` 定义）报「未注册的函数」。
      //
      // **实现要点**：直接**压入该列命令的帧**（不切 `coord`、不装元素）——
      // 因为「子过程」是**被调用的代码块**，不是「进入一个新场景」：
      // ① 作用域沿用 func 的块级语义（`enterChild`，不污染列级作用域）
      // ② `func: true` 标记复用 ⇒ `return` 与「列尾出帧」两条路径都能正确回到调用点
      // ③ 调用者位置先 `index += 1` ⇒ 返回点 = 下一条
      const column = this.columnById(name);
      if (column === undefined) {
        this.fail(
          "call-unknown-target",
          `调用目标不存在：${name}（既不是 func 也不是列）`,
        );
        return false;
      }
      if (column.kind !== "flow") {
        this.fail(
          "call-invalid-target",
          `call 只能调用流程列（flow）；${name} 是场景列（scene）——` +
            `空间层切换请用 navigate/jump`,
        );
        return false;
      }
      frame.index += 1;
      const scope = frame.scope.enterChild();
      this.frames.push({
        columnId: null,
        commands: column.commands ?? [],
        index: 0,
        scope,
        func: true,
      });
      return true;
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

  /** return：弹出函数帧及其内部块帧，回到调用方；函数外 return fail-closed */
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

  /** input（prompt + store）→ 进入 input 等待；options 选项式输入延后（解析层拒绝） */
  private execInput(frame: Frame, cmd: StoryCommand): void {
    if (this.rejectBadInstanceZ(cmd)) return; // 先拒非法 z（不动状态）
    // 输入态清对话残留（与 menu 同语义）
    this.setSystem(SYS.currentDialogText, "");
    this.setSystem(SYS.currentDialogSpeaker, "");
    this.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
    this.setSystem(
      SYS.inputPrompt,
      typeof cmd.prompt === "string" ? this.translate(cmd.prompt) : "",
    );
    this.inputStore = cmd.store as string;
    this.setInstanceZ(SYS.choicesZ, cmd.z); // 输入形态的实例 z（choices 层）
    this.setSystem(SYS.waiting, "input");
    // input 检查点在等待建立时；重放期同坐标原位替换
    this.commitCheckpoint(this.takeSnapshot(this.checkpointCoord(frame)));
    this.liveCheckpointed = true;
    this.autoSaveAtCheckpoint(); // input 等待画面建立 = auto_save 消费点
    frame.index += 1;
  }

  /** 命令面 input(text)：输入等待的唯一解除入口；store 未定义 fail-closed */
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
    this.liveCheckpointed = false; // 提交改变画面：live 未入档
    this.run();
  }

  // —— 存档编排（TS 侧；加密/AAD/高水位安全在 Rust 层） ——

  /** 当前 live 位置所在的列帧（块帧之下） */
  private columnFrame(): Frame | undefined {
    for (let i = this.frames.length - 1; i >= 0; i -= 1) {
      if (this.frames[i]!.columnId !== null) return this.frames[i];
    }
    return undefined;
  }

  /** 按坐标重建列帧（存档不进帧栈——块/列级作用域不进档，读档后确定性重放重建） */
  private columnFrameAt(coord: ColumnCoordinate): Frame {
    const column = this.columnById(coord.columnId)!;
    return {
      columnId: coord.columnId,
      commands:
        column.kind === "flow" ? column.commands! : (column.entry ?? []),
      index: coord.index,
      scope: Scope.root(),
    };
  }

  /**
   * 导出存档载荷。必须在等待点调用（列尾/未启动 fail-closed 拒绝）。
   * 载荷 = 等待点坐标 + 全局状态 + rngState + 函数表 + 历史；不含块/列级作用域与帧栈。
   *
   * **场景类型守卫**：在 `menu`/`ui` 场景按存档，**存的是「菜单前的游戏进度」
   * 而不是菜单状态**（对标 Ren'Py Esc 菜单存档）。
   * 手法：维护 `__menuReturn`（进入菜单前的**可回溯坐标** + 等待态），
   * 导出时用它替换当前坐标；**没有 `__menuReturn` ⇒ 拒绝存档**
   * （没有正在进行的游戏）。
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
    // 序列化边界深校验（「存档时」半边）：写入时契约 + 写时复制
    // 挡不住「拿到引用后原地改值」（作者行为）——在真正序列化前拦下，杜绝"写档才抛/静默变形"。
    // 快照里的 state 与活状态共享同一批值引用（写时复制），校验活状态即覆盖历史副本。
    for (const [key, value] of this.state) {
      const unsafe = findJsonValueError(value, key);
      if (unsafe !== null) {
        this.fail(
          "value-not-serializable",
          `状态含不可序列化值，存档被拒绝：${unsafe}（请检查是否有原地修改已写入的值；应整值替换）`,
        );
        return null;
      }
    }
    // 场景类型守卫：非 game 场景导出 ⇒ 存「菜单前的游戏进度」。
    // 手法：把当前坐标/等待态换成`__menu_return` 里记的游戏点；
    // **无该记账 ⇒ 拒绝存档**（没有正在进行的游戏）。
    const rawReturn = this.get(SYS.menuReturn);
    const menuReturn = parseMenuReturn(rawReturn);
    let coord: ColumnCoordinate;
    let historyCursor = this.cursor;
    let historyList = this.history;
    if (!this.isCurrentColumnReplayable()) {
      if (menuReturn === null) {
        this.fail(
          "save-invalid",
          "当前在菜单/界面中，且没有可返回的游戏进度——无法存档（请先回到游戏场景）",
        );
        return null;
      }
      coord = menuReturn.coord;
      // 历史游标一并回退：菜单期间的历史是「覆盖」产生的，不该算进玩家进度
      const back = this.lastReplayableCursor();
      if (back !== null) historyCursor = back;
      historyList = this.history.slice(0, historyCursor + 1);
    } else {
      coord = {
        columnId: columnFrame.columnId,
        index: Math.max(0, columnFrame.index - 1),
      };
    }
    return {
      formatVersion: 1,
      storyId: this.story.id,
      coord,
      state: [...this.state.entries()],
      rngState: this.rngState,
      functions: [...this.functions.entries()],
      cursor: historyCursor,
      history: historyList.map((cp) => ({
        coord: { ...cp.coord },
        state: cp.snapshot.state,
        rngState: cp.snapshot.rngState,
      })),
      // 本档实际执行过的扩展（未用到 = 字段缺席，缺扩展也能读——防假阳性）
      ...(this.usedExtensions.size > 0
        ? {
            extensions: [...this.usedExtensions].flatMap((id) => {
              const ext = this.extensionById.get(id);
              return ext ? [{ id, stateVersion: ext.stateVersion }] : [];
            }),
          }
        : {}),
    };
  }

  /**
   * 读档——恢复全局态与历史，从存档坐标重放重建等待点。
   * 帧栈按坐标重建列帧；故事版本不匹配 fail-closed。
   * 返回 false = 已拒绝（engine.error 事件已出站），调用方不得当作成功处理。
   */
  importSave(data: SaveDataV1): boolean {
    if (data?.formatVersion !== 1) {
      const migrated = this.tryMigrateSave(data); // 版本迁移优先于拒绝
      if (migrated === null) return false;
      data = migrated;
    }
    // fail-closed：结构不完整或坐标失效（列定义已变更）= 存档与当前故事版本不匹配。
    // 全量预校验（含历史检查点坐标），任何不符都不得进入恢复流程（防 TypeError 式崩溃）。
    if (
      !Array.isArray(data.state) ||
      !Array.isArray(data.functions) ||
      !Array.isArray(data.history) ||
      typeof data.coord?.columnId !== "string" ||
      !Number.isFinite(data.coord.index) || // NaN/Infinity 不得深入恢复流程
      !Number.isFinite(data.rngState)
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
    // 深层校验：历史检查点 state/rngState 逐项校验——缺失/畸形时
    // 会静默产出 NaN 或恢复期 TypeError；cursor 缺失回默认值、类型错 fail-closed（见下）。
    for (const h of data.history) {
      if (!h || !Array.isArray(h.state) || !Number.isFinite(h.rngState)) {
        this.fail(
          "save-format",
          "存档历史检查点不完整（state/rngState 缺失或类型错误）",
        );
        return false;
      }
    }
    if (data.cursor !== undefined && !Number.isFinite(data.cursor)) {
      this.fail("save-format", "存档 cursor 类型错误（须为有限数字；缺失可回默认值）");
      return false;
    }
    // 扩展依赖校验（fail-closed 整档预校验；migrate 在进入恢复流程前完成）
    const stagedState = this.resolveSaveExtensions(data);
    if (stagedState === null) return false; // 已发 engine.error（整档拒绝）
    this.clearTimer();
    this.abortMinigame(); // 读档打断小游戏：abort 挂载信号（重放重新挂载）
    // 引用备份（restore 失败 = 整档拒绝 → 原样回退；以下字段在读档路径只做整体换引用）
    const backup = {
      state: this.state,
      rngState: this.rngState,
      functions: this.functions,
      history: this.history,
      cursor: this.cursor,
      frames: this.frames,
      coord: this.coord,
      started: this.started,
      pendingSay: this.pendingSay,
      liveCheckpointed: this.liveCheckpointed,
    };
    this.state = new Map(stagedState);
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
    // cursor 缺失回默认 = 最近检查点（空历史落 -1，与「无检查点」初始语义一致）
    this.cursor =
      data.cursor === undefined
        ? this.history.length - 1
        : Math.min(Math.max(data.cursor, 0), this.history.length - 1);
    this.started = true;
    this.pendingSay = null;
    this.frames = [this.columnFrameAt(data.coord)];
    this.coord = { ...data.coord };
    this.liveCheckpointed = true;
    if (!this.restoreSaveExtensions(data.extensions)) {
      Object.assign(this, backup); // 原样回退（备份点之后零事件出站，观察面无脏镜像）
      return false; // restore 失败 = 整档拒绝
    }
    // 依赖标记随档继承（读档后再存档不丢依赖；restore 成功后才落账）
    this.usedExtensions.clear();
    for (const mark of data.extensions ?? []) this.usedExtensions.add(mark.id);
    this.setSystem(SYS.waiting, "none");
    this.run(); // 确定性重放：从存档命令重建等待画面（同坐标提交由 commitCheckpoint 原位替换）
    return true;
  }

  /**
   * `formatVersion` 非 1 的档——优先经宿主 migrateSave 钩子迁移（成功发 `load.notice`）；
   * 不可迁移才拒绝，且文案必须可操作（说明档/引擎版本与可选路径，不得只说「不支持」）。
   */
  private tryMigrateSave(data: SaveDataV1): SaveDataV1 | null {
    const fromVersion = (
      data as { formatVersion?: unknown } | null | undefined
    )?.formatVersion;
    const hook = this.migrateSaveHook;
    if (hook) {
      try {
        const migrated = hook(data);
        if (migrated?.formatVersion === 1) {
          this.emitEvent({
            kind: "load.notice",
            text: `存档已从 v${String(fromVersion)} 迁移到 v1（migrateSave）`,
          });
          return migrated;
        }
      } catch {
        // 宿主钩子违约（抛出）= 视同无法迁移，走可操作拒绝（读档链不中断）
      }
    }
    this.fail(
      "save-format",
      `存档格式版本不支持：档为 v${String(fromVersion)}，引擎为 v1。请用创建该存档的引擎版本打开，或在构造引擎时提供 migrateSave 钩子完成版本迁移`,
    );
    return null;
  }

  /**
   * 读档扩展依赖校验 + 状态迁移（fail-closed 整档预校验——任何不符在进入恢复流程前拒绝）。
   * 返回迁移后的状态条目（无迁移 = 原引用原样返回）；null = 已发 engine.error（整档拒绝，状态原样）。
   */
  private resolveSaveExtensions(data: SaveDataV1): [string, unknown][] | null {
    const marks = data.extensions;
    if (marks === undefined) return data.state; // 未用到扩展的存档不带标记（防假阳性：缺扩展也能读）
    if (!Array.isArray(marks)) {
      this.fail("save-format", "存档扩展依赖标记不合法（须为数组）");
      return null;
    }
    let entries = data.state;
    for (const mark of marks) {
      if (
        mark === null ||
        typeof mark !== "object" ||
        typeof mark.id !== "string" ||
        !Number.isInteger(mark.stateVersion) ||
        mark.stateVersion < 1
      ) {
        this.fail(
          "save-format",
          "存档扩展依赖标记不合法（条目须为 { id, stateVersion }）",
        );
        return null;
      }
      const ext = this.extensionById.get(mark.id);
      if (ext === undefined) {
        this.fail(
          "extension-missing",
          `存档依赖的扩展未注册：「${mark.id}」。请安装并启用该扩展后再读档`,
        );
        return null;
      }
      if (ext.stateVersion === mark.stateVersion) continue;
      // 版本不一致：仅支持「档旧 → 扩展新」迁移；档新于扩展（引擎过旧）或无 migrate → 拒绝
      if (mark.stateVersion < ext.stateVersion && ext.migrate) {
        const prefix = `${EXT_KEY_PREFIX}${mark.id}.`;
        const subset: Record<string, unknown> = {};
        for (const [key, value] of entries) {
          if (key.startsWith(prefix)) subset[key.slice(prefix.length)] = value;
        }
        let migrated: Record<string, unknown> | null;
        try {
          migrated = ext.migrate(mark.stateVersion, subset);
        } catch {
          migrated = null; // 扩展违约（不抛约束）→ 视同无法迁移
        }
        if (migrated === null) {
          this.fail(
            "extension-version",
            `扩展「${mark.id}」无法从状态版本 v${mark.stateVersion} 迁移到 v${ext.stateVersion}，存档被拒绝`,
          );
          return null;
        }
        entries = [
          ...entries.filter(([key]) => !key.startsWith(prefix)),
          ...Object.entries(migrated).map(
            ([key, value]) => [`${prefix}${key}`, value] as [string, unknown],
          ),
        ];
        this.emitEvent({
          kind: "load.notice",
          text: `扩展「${mark.id}」状态已从 v${mark.stateVersion} 迁移到 v${ext.stateVersion}`,
        });
        continue;
      }
      this.fail(
        "extension-version",
        `存档依赖扩展「${mark.id}」的状态版本 v${mark.stateVersion}，当前注册版本为 v${ext.stateVersion}（存档过新或缺少迁移路径），存档被拒绝`,
      );
      return null;
    }
    return entries;
  }

  /**
   * 读档恢复钩子——对档内标记的扩展逐个调 restore（重建运行期句柄，等价小游戏重新挂载）。
   * 返回 false（或抛出）= 不可恢复 → 调用方整档拒绝（此时仅字段引用交换、零事件出站，
   * 引擎状态即原样）；engine.error 由本方法发出。
   */
  private restoreSaveExtensions(marks: SaveDataV1["extensions"]): boolean {
    for (const mark of marks ?? []) {
      const ext = this.extensionById.get(mark.id);
      if (ext?.restore === undefined) continue;
      let ok: boolean;
      try {
        ok = ext.restore(
          buildExtensionContext(mark.id, {
            get: (key) => this.get(key),
            setGlobal: (key, value) => this.setGlobal(key, value),
            story: this.story,
          }),
        );
      } catch {
        ok = false; // 扩展违约（不抛约束）→ 不可恢复
      }
      if (!ok) {
        this.fail(
          "extension-restore",
          `扩展「${mark.id}」读档恢复失败（restore 返回 false），存档被拒绝`,
        );
        return false;
      }
    }
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
    this.abortMinigame(); // 回溯打断小游戏：abort 挂载信号，重放重新挂载
    this.waitSkipable = false;
    this.liveCheckpointed = true; // 检查点 k 即当前 live 位置（重放中的等待点会自行改写）
    this.setSystem(SYS.waiting, "none");
  }

  /**
   * 提交检查点（分岔 + 容量淘汰）：
   * - 重取同坐标（回溯后重放推进）→ 原位替换，不动时间线
   * - 与前向时间线同坐标 → cursor 前移（rollforward 保留）
   * - 同列内介于 cursor 与下一检查点之间 → 新发现的中间站：插入（残缺历史自愈）
   * - 其余坐标不同 → 截断旧前向（重选≠ 旧选择 = 新时间线）
   *
   * **场景类型守卫**：`type !== "game"`
   * 的列（menu/ui）**不建检查点**——菜单/弹窗是「覆盖」，不是玩家经历的一步。
   */
  private commitCheckpoint(cp: Checkpoint): void {
    // 非 game 场景不进历史（menu/ui 是覆盖层，不构成可回溯的一步）
    if (!this.isCurrentColumnReplayable()) return;
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
      this.history.length = this.cursor + 1; // 开辟新时间线，旧前向作废
    }
    if (
      this.history.length >= this.historyLimit &&
      this.cursor === this.history.length - 1
    ) {
      this.history.shift(); // 容量淘汰最旧（未回溯状态下安全）
    }
    this.history.push(cp);
    this.cursor = this.history.length - 1;
  }

  /**
   * 存档点消费：等待画面建立（say 上屏 / menu / wait / input）= 玩家所见稳定点。
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
   * 补交规则：离开当前画面（回退/跳转）前，把已上屏未入档的 say 检查点补交入档。
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
   * 回溯三步：找目标检查点 → 恢复快照 → 重放到该等待点。
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
    // 重放期输入锁 + 完成后解除并广播
    this.rollbackActive = true;
    this.setSystem(SYS.rollbackActive, true);
    this.run(); // 同步重放至等待点（menu 真实等待）
    this.rollbackActive = false;
    this.setSystem(SYS.rollbackActive, false);
    // 重放落点即检查点 k 的等待点——live 视为已入档，back() 才能继续向前回退
    this.liveCheckpointed = true;
    this.emitEvent({ kind: "rollback.done", coordinate: { ...this.coord } });
  }

  /** 滚轮上：回退一步。live 已入档 → 退到前一个；未入档（如菜单选择后）→ 落回当前检查点（重选菜单） */
  /**
   * 历史长度（**只读出口**，供 UI 判据与测试共用）。
   *
   * 为什么需要出口：`back()` 会先`flushPendingCheckpoint`（离开当前画面即所见入档），
   * 所以「有没有在菜单里建点」**不能靠 back() 的落点反推**——那测的是 flush 语义，
   * 不是守卫。要精确断言「菜单期间历史没变」必须直接读长度。
   */
  historyLength(): number {
    return this.history.length;
  }

  /** 历史游标（只读出口；配`historyLength` 判定「回退了几步」） */
  historyCursor(): number {
    return this.cursor;
  }

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

  /** 滚轮下：沿未截断时间线 rollforward（分岔后旧前向已截断） */
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
   * 热重载（原子替换故事树，运行态保留）
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
   * 历史面板数据（前端职责的可视化皮）：对话类检查点带说话者与文本；
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

  /** mulberry32 确定性随机 [0,1)：rngState 进快照，回溯重放序列必然一致 */
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

  /** random op（显式种子）：重置 rngState 为种子 → 抽值 → 写入 var */
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
   * set/define 负载值（表达式一律 {} 包裹，字符串原样即字面量）：
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
   * 名称解析（作用域链查找语义）：
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

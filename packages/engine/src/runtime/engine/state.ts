/**
 * 引擎状态层：`StoryEngine` 的状态字段与一次性装配。
 *
 * 与 `../engine.ts`、`./forwarders.ts` 的分工：本层只声明状态与构造期装配（端口、扩展/玩法注册、守卫表），
 * 命令处理留在 `StoryEngine`，私有面转发器（历史/存档/国际化/状态写入的自由函数转出）在 `./forwarders.ts`。
 * 字段用 `protected` 供 `StoryEngine` 的命令面与 `buildOpContext()` 的编译期互锁清单引用；
 * 该互锁靠「类内引用私有成员」生效，因此字段不能搬到类外（搬出去就只剩结构断言、丢掉改名即报错的保护）。
 *
 * 改字段含义看本层；改行为去 `./internal`、`./state`、`./history`、`./save`、`./ops`、`./i18n`。
 */
import type {
  CharacterDef,
  ColumnCoordinate,
  EngineOptions,
  EngineTexts,
  EventListener,
  I18nPort,
  MinigameRegistration,
  OpExtension,
  SaveMode,
  SavePort,
  StateListener,
  Story,
  StoryCommand,
  TimerHandle,
  TimerPort,
  GuardFn,
  SaveDataV1,
} from "../../contracts/index.ts";
import { defaultEngineTexts, hostTimer } from "../../contracts/index.ts";
import {
  buildMinigameRegistry,
  buildOpRegistry,
  type RegisteredOp,
} from "../opRegistry.ts";
import type { Frame, Checkpoint, OpContext } from "../internal/index.ts";

export class EngineCore {
  /**
   * 命令处理器与执行器私有面之间的唯一通道；由子类 `StoryEngine` 在构造器末尾赋值。
   *
   * 接口声明与实际成员的一一对应由 `StoryEngine.buildOpContext()` 的登记清单在编译期兜住。
   */
  protected ctx!: OpContext;

  /** 故事定义；`reloadStory()` 会原子替换它，所以推进时每次现取字段，不要缓存引用 */
  protected story: Story;
  /** SSOT：系统键 + 全局用户键（块/列级变量在 Scope 树，不进此 Map）；值写时复制 → 快照浅拷贝安全 */
  protected state = new Map<string, unknown>();
  /** 当前执行坐标（列 id + 列内命令下标）；帧栈与历史检查点都以它为坐标 */
  protected coord: ColumnCoordinate = { columnId: "", index: 0 };
  /** 帧栈：每层是一个正在展开的块/列执行上下文，栈顶即当前推进位置 */
  protected frames: Frame[] = [];
  /** 状态变化订阅者（ValueChanged）；写入时同步回调，单个订阅者抛错会向外冒 */
  protected readonly stateListeners = new Set<StateListener>();
  /** 对外事件订阅者（进度与错误同走本集合）；与状态订阅同模块但各自独立广播 */
  protected readonly eventListeners = new Set<EventListener>();
  /** 是否已 `start()`；未开始时推进类命令一律无效果（防重复入场） */
  protected started = false;
  /** 等待型命令的定时器句柄；换列、回溯、读档、热重载、销毁时必须清掉，否则会推进已失效的等待 */
  protected pendingTimer: TimerHandle | null = null;
  /** 定时器端口（wait/pause 的延迟回调来源；缺省 hostTimer = 宿主全局定时器） */
  protected readonly timerPort: TimerPort;
  /** 用户可见文案表（缺省 defaultEngineTexts；宿主经 EngineOptions.texts 部分覆盖） */
  protected readonly texts: EngineTexts;
  /** 当前等待能否被 `advance()` 解除（wait 的 skipable 且非 hard/pause）；只在引擎内部作为推进判据 */
  protected waitSkipable = false;
  /** 角色定义注册表（character 注册 / uncharacter 注销；随快照恢复） */
  protected characters = new Map<string, CharacterDef>();
  /** 函数注册表（func 执行期注册，call 按名查表；随快照恢复） */
  protected functions = new Map<
    string,
    { params: string[]; body: StoryCommand[] }
  >();
  /** input 命令挂起时的写入目标键名（值由提交方写到该键）；解除等待时清空，null = 当前没有挂起的 input */
  protected inputStore: string | null = null;
  // —— 回溯与历史 ——
  /** 历史检查点上限（构造期定死）；超出后从最旧端丢弃，所以可回溯深度有限 */
  protected readonly historyLimit: number;
  /** 已归档的检查点序列，下标 0 最旧；与 `cursor` 配合表达「看到第几个」 */
  protected history: Checkpoint[] = [];
  /** 光标 = 当前时间线上最后归档的检查点（回溯后落后于 length-1；rollforward 用） */
  protected cursor = -1;
  /** live 消歧：当前 live 画面是否已入档（menu/wait/input 展示中=true；say 上屏=false） */
  protected liveCheckpointed = false;
  /** 重放期标记（__rollback_active 键镜像） */
  protected rollbackActive = false;
  /** say 上屏时捕获的待提交检查点（等待解除后才入档） */
  protected pendingSay: Checkpoint | null = null;
  /** 确定性随机状态（mulberry32），进快照 */
  protected rngState: number;
  /** se 触发序号：单调递增且不进快照——重放/读档后仍能区分「再次触发」 */
  protected mediaSeq = 0;
  /** 视频命令序号：单调递增且不进快照（渲染器按 seq 执行/去重） */
  protected videoSeq = 0;
  /** 元素动画序号：单调递增且不进快照（连续动画与重放后的同命令可分辨） */
  protected animationSeq = 0;
  /** 转场启动序号：单调递增且不进快照（UI 据此判定「新的一次」） */
  protected transitionSeq = 0;
  /** 震动启动序号：与 transitionSeq 同构（每次 shake 命令递增，宿主据此判定「新的一次」） */
  protected shakeSeq = 0;
  /** 小游戏挂载序号：单调递增且不进快照（重放重新挂载与旧挂载可分辨） */
  protected minigameSeq = 0;
  /** 挂起的小游戏等待：注册 game 标识、分流目标与已求值奖励（resolveMinigame 消费；中断即清除） */
  protected pendingMinigame: {
    game: string;
    onSuccess?: string;
    onFail?: string;
    reward: { key: string; value: unknown }[];
  } | null = null;
  /** 当前挂载的中断信号源：回溯/读档/导航/销毁时 abort（UI 据此卸载） */
  protected minigameController: AbortController | null = null;
  /** 外部玩法系统挂载序号（与 minigameSeq 同构：单调、不进快照） */
  protected interactionSeq = 0;
  /** 挂起的玩法系统接管：系统标识 + 分流目标（resolveInteraction 消费；中断即清除） */
  protected pendingInteraction: {
    system: string;
    onSuccess?: string;
    onFail?: string;
  } | null = null;
  /** 当前玩法系统挂载的中断信号源（回溯/读档/导航/销毁时 abort） */
  protected interactionController: AbortController | null = null;
  /** 扩展 op 等待挂载序号（与 interactionSeq 同构：单调、不进快照） */
  protected extensionWaitSeq = 0;
  /** 挂起的扩展 op 等待：op 标识 + 扩展 id + 分流目标（resolveExtensionOp 消费；中断即清除） */
  protected pendingExtensionOp: {
    op: string;
    extensionId: string;
    onSuccess?: string;
    onFail?: string;
  } | null = null;
  /** 当前扩展挂载的中断信号源（回溯/读档/导航/销毁时 abort） */
  protected extensionController: AbortController | null = null;

  /** 存档编排端口与模式（组合根注入；缺省 = 存档类 op/命令面 fail-closed） */
  protected savePort: SavePort | undefined;
  /** 存档模式：决定存档可否跨设备读取，也决定 DEK 封装方式（本机绑定 = 用 OS 凭据封存；可携带 = 明文随档）；构造期注入，运行期不变 */
  protected saveMode: SaveMode;
  /** save op 的一次性存档声明：载荷在下一玩家所见等待画面落档（coord = 等待点） */
  protected pendingSave: { slot: string; title?: string } | null = null;
  /** I18N 端口与当前语言译文表（null = 原文直出；切换 = 整表重建并清缓存） */
  protected i18nPort: I18nPort | undefined;
  /** 当前语言译文表（原文 → 译文）；由 `setLanguage()` 整表重建 */
  protected overlay: Map<string, string> | null = null;
  /** 扩展 op 注册表（构造期校验装配；查找序 = 内建 → 扩展 → unknown-op） */
  protected readonly extensionOps: Map<string, RegisteredOp>;
  /** 扩展声明索引（id → 声明：存档依赖校验 / migrate / restore 用） */
  protected readonly extensionById: ReadonlyMap<string, OpExtension>;
  /** 本档实际执行过的扩展（op 执行时登记；exportSave 落盘依赖标记；读档继承档内标记） */
  protected readonly usedExtensions = new Set<string>();
  /** 本档实际回填过状态的玩法系统（resolveMinigame 登记；exportSave 落盘；读档继承档内标记） */
  protected readonly usedMinigames = new Set<string>();
  /** 全局层删除墓碑（execUndef 记账；随快照/存档/回溯随行；读档垫底的挡板） */
  protected readonly deleted = new Set<string>();
  /** 玩法系统声明索引（gameId → 声明：存档依赖校验 / migrate 用） */
  protected readonly minigameById: ReadonlyMap<string, MinigameRegistration>;
  /** 故事级状态迁移钩子（宿主注入；缺省 = storyVersion 不一致可操作拒绝） */
  protected readonly migrateStateHook?:
    | ((
        state: Record<string, unknown>,
        from: { storyVersion: number },
      ) => Record<string, unknown> | null)
    | undefined;
  /** 存档版本迁移钩子（宿主注入；缺省 = 非 v1 档可操作拒绝） */
  protected readonly migrateSaveHook?: (data: unknown) => SaveDataV1 | null;
  /** 运行期守卫注册表（组合根注入；缺省 = guard op 一律 guard-unknown fail-closed） */
  protected readonly guards: Readonly<Record<string, GuardFn>>;

  /**
   * 装配状态：登记故事定义、各端口与扩展。
   *
   * 选项全部可省：缺省时历史上限 200、随机种子取当前时间、存档模式 `machine-bound`，
   * 且没有存档 / 国际化 / 守卫 / 扩展。缺端口不影响推进，只让对应命令面 fail-closed
   * （例如没有存档端口时 `save()` 固定返回 false）。
   *
   * 只做状态装配，不建 `ctx` 通道（那在 `StoryEngine` 构造器末尾）；子类不要提前使用 `this`。
   */
  constructor(story: Story, options?: EngineOptions) {
    this.story = story;
    this.historyLimit = options?.historyLimit ?? 200;
    this.rngState = (options?.rngSeed ?? Date.now()) | 0;
    this.savePort = options?.savePort;
    this.saveMode = options?.saveMode ?? "machine-bound";
    this.i18nPort = options?.i18nPort;
    this.timerPort = options?.timerPort ?? hostTimer;
    this.texts = { ...defaultEngineTexts, ...options?.texts };
    const extensions = options?.extensions ?? [];
    this.extensionOps = buildOpRegistry(extensions);
    this.extensionById = new Map(extensions.map((e) => [e.id, e]));
    this.migrateSaveHook = options?.migrateSave;
    // 玩法系统注册（构造期校验装配，fail-fast，与扩展注册同口径；校验细节见 buildMinigameRegistry）
    this.minigameById = buildMinigameRegistry(options?.minigames ?? []);
    this.migrateStateHook = options?.migrateState;
    this.guards = options?.guards ?? {};
  }
}

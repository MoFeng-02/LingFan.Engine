/**
 * 02-执行模型：SSOT 状态容器 + 逐命令解释执行 + advance 唯一对话推进入口。
 * 框架无关：只写状态与事件，渲染归 UI 层（08-U1）。
 */
import type {
  ColumnCoordinate,
  EventListener,
  OutboundEvent,
  StateListener,
  Story,
  StoryColumn,
  StoryCommand,
  ValueChanged,
} from "./contracts";
import { SYS } from "./contracts";

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

export class StoryEngine {
  private readonly story: Story;
  /** 02 §一.1 SSOT：唯一状态对象（纯 Map，不用框架响应式——UI 自己订阅） */
  private readonly state = new Map<string, unknown>();
  private coord: ColumnCoordinate = { columnId: "", index: 0 };
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private started = false;

  constructor(story: Story) {
    this.story = story;
  }

  // —— 观察接缝 ——

  /** 02-E1：ValueChanged 是唯一观察接缝；所有状态写入都经 set() 镜像到这里 */
  onStateChanged(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** 02 §三.1 出站事件信封：engine.error 等 */
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

  // —— 会话命令面（02 §三.2 最小子集：start / advance） ——

  /** story.start：进入入口列。入口列终态取自工程清单 entry 字段（01 §一.7）；最小闭环用首列 */
  start(): void {
    if (this.started) {
      this.fail("already-started", "故事已启动，重复 start 无效");
      return;
    }
    const first = this.story.columns[0];
    if (first === undefined) {
      this.fail("no-entry-column", "故事没有可用列（columns 为空）");
      return;
    }
    this.started = true;
    // 01 §一.6：顶层 defines 无条件 Set
    for (const [key, value] of Object.entries(this.story.defines ?? {})) {
      this.set(key, value);
    }
    this.goto(first.id);
    this.run();
  }

  /** 02 §三.3：advance = `__dialog_complete = true`——对话推进唯一入口，不要发明第二条（E5） */
  advance(): void {
    if (!this.started || this.get(SYS.waiting) !== "dialog") {
      this.fail(
        "advance-invalid",
        `advance 仅在对话等待中有效（当前 __waiting=${String(this.get(SYS.waiting))}）`,
      );
      return;
    }
    this.set(SYS.dialogComplete, true);
    // 02 §二.3：离开等待后清 clickable/noskip，防状态泄漏到后续非 say 命令
    this.set(SYS.dialogClickable, false);
    this.set(SYS.dialogNoskip, false);
    this.set(SYS.waiting, "none");
    this.run();
  }

  // —— 内部实现 ——

  private set(key: string, value: unknown): void {
    this.state.set(key, value);
    // 04 作用域树落地前 scope 二分为 system/global 占位
    const change: ValueChanged = {
      key,
      value,
      scope: key.startsWith("__") ? "system" : "global",
    };
    for (const listener of this.stateListeners) listener(change);
  }

  /** E3：engine.error 事件出站，绝不静默 */
  private fail(code: string, message: string): void {
    const event: OutboundEvent = {
      v: 1,
      kind: "event",
      payload: { code, message, coordinate: { ...this.coord } },
    };
    for (const listener of this.eventListeners) listener(event);
  }

  /** F1 运行期：跳转目标不存在 = fail-closed；02 §四.3：切列语义（元素快照延后） */
  private goto(columnId: string): void {
    const column = this.columnById(columnId);
    if (column === undefined) {
      this.fail(
        "unknown-column",
        `目标列不存在：${columnId}（F1：跳转目标必须存在）`,
      );
      return;
    }
    this.coord = { columnId, index: 0 };
    this.set(SYS.currentSceneColumn, columnId);
  }

  private columnById(id: string): StoryColumn | undefined {
    return this.story.columns.find((c) => c.id === id);
  }

  /** 02 §二.1 逐命令解释执行：取命令 → 执行 → 前进；遇等待点即停（调用方保证 __waiting=none） */
  private run(): void {
    for (;;) {
      const column = this.columnById(this.coord.columnId);
      if (column === undefined) {
        this.fail("unknown-column", `当前列不存在：${this.coord.columnId}`);
        return;
      }
      const commands =
        column.kind === "flow"
          ? column.commands!
          : [...(column.elements ?? []), ...(column.entry ?? [])];
      if (this.coord.index >= commands.length) return; // 列尾：本列故事段结束
      const cmd = commands[this.coord.index]!;
      if (cmd.op === "say") {
        this.execSay(cmd);
        return; // say 进入对话等待，暂停循环
      }
      // E3 fail-closed：未知/未实现 op 不静默跳过
      this.fail("unknown-op", `未知或未实现的命令：${cmd.op}`);
      return;
    }
  }

  /** say：写对话系统键 → 进入 dialog 等待（02 §二.2/3；say 参数语义照搬 01 §二.1） */
  private execSay(cmd: StoryCommand): void {
    // E3：负载字段不符 = error（先校验后写入，拒绝的命令零副作用）
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

    // 02 §二.3 竞态防护：进入等待前清上一句残留的完成标记（防双击/快速点击跳句）
    this.set(SYS.dialogComplete, false);
    this.set(
      SYS.currentDialogSpeaker,
      typeof cmd.speaker === "string" ? cmd.speaker : "",
    );
    this.set(SYS.currentDialogText, cmd.text);
    this.set(SYS.dialogClickable, cmd.clickable === true);
    this.set(SYS.dialogNoskip, cmd.noskip === true);
    this.set(SYS.waiting, "dialog");
    // 坐标推进：say 进入等待即前移，坐标始终指向「下一待执行命令」——与 03-R1「检查点在用户所见之后」对齐
    this.coord.index += 1;
  }
}

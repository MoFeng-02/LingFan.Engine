/**
 * 应用内对话框的**状态机**（纯逻辑，零 DOM）。
 *
 * 为何替换原生 `prompt`/`confirm`/`alert`（共 10 处）：原生在深色主题下弹**系统
 * 灰白框**、阻塞、不可样式化，且**取消语义各写各的**（D-62① 由此生出 D-58
 * 「取消＝新建」的数据丢失缺陷）。本模块把三种语义收成**一套显式判据**：
 *
 * | 调用 | 取消（Esc） | 留空（确定） | 有值（确定） |
 * |---|---|---|---|
 * | `askText` | 解析为 `null`（**不执行**） | 解析为 `""`（**执行，无值**） | 解析为输入值 |
 * | `askConfirm` | `false` | — | `true` |
 * | `notify` | （无取消） | — | — |
 *
 * ⚠️ `askText` 的「取消 vs 留空」是 D-58 的病根 ⇒ 判据集中在 `parseTextAnswer`，
 * **组件与调用方都不再自己判 `=== null`**。
 */

/**
 * 回答值：`null` = **取消**（文本框语义，必须能与「留空」区分 —— 这正是 D-58 的病根）
 * ｜ `string` = 确定的文本 ｜ `true` = 确认 ｜ `false` = 否认
 */
export type DialogAnswer = string | boolean | null | undefined;

/** 对话框请求（宿主渲染哪种形态由 `kind` 决定） */
export type DialogRequest =
  | {
      readonly kind: "text";
      readonly title: string;
      readonly message?: string;
      readonly initial?: string;
      readonly placeholder?: string;
      /** 留空是否允许（`false` 时留空 = 不执行，语义更严） */
      readonly allowEmpty?: boolean;
    }
  | {
      readonly kind: "confirm";
      readonly title: string;
      readonly message: string;
      /** 危险操作的确认文案（删除等） */
      readonly danger?: boolean;
    }
  | {
      readonly kind: "notice";
      readonly title: string;
      readonly message: string;
      readonly tone?: "info" | "warning" | "error";
    };

/** 对话框栈的最小只读面（组件用它渲染当前请求） */
export interface DialogSnapshot {
  readonly current: DialogRequest | undefined;
  /** 嵌套深度（`confirm` 里再 `alert` 时不丢上下文） */
  readonly depth: number;
}

/**
 * `askText` 的答案判据（**D-58 的正解在此**）：
 * 取消 = `null` ⇒ **不执行**；留空 = `""` ⇒ 执行但无值（`allowEmpty` 为假时视为取消）。
 */
export function parseTextAnswer(
  answer: string | null,
  allowEmpty: boolean,
): { run: false } | { run: true; value: string } {
  if (answer === null) return { run: false }; // 取消/Esc ⇒ 不执行
  if (answer === "" && !allowEmpty) return { run: false };
  return { run: true, value: answer };
}

/** 对话框栈（支持嵌套：后进先出） */
export class DialogHostState {
  private readonly stack: DialogRequest[] = [];
  /** 等待回答的结算器（**每次开框覆盖**，与「同时只挂一个调用者」同语义） */
  private settle: ((raw: DialogAnswer) => void) | undefined;
  private readonly listeners = new Set<() => void>();

  get current(): DialogRequest | undefined {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length;
  }

  get snapshot(): DialogSnapshot {
    return { current: this.current, depth: this.stack.length };
  }

  /** 订阅栈变化（宿主驱动渲染用）；返回退订函数 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 开框并挂起等待回答。
   *
   * ⚠️ 语义：**当前框被回答或取消时结算**（`current` 回到 `undefined` 或换框）。
   * 回答经 `answer` 注入 ⇒ 判据仍在 `parseTextAnswer`（纯函数、可测）。
   */
  ask(request: DialogRequest): Promise<DialogAnswer> {
    this.stack.push(request);
    this.emit();
    return new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  /** 注入回答（组件调）⇒ 弹出当前框并结算等待者 */
  answer(raw: DialogAnswer): void {
    const settle = this.settle;
    this.settle = undefined;
    this.stack.pop();
    this.emit();
    settle?.(raw);
  }

  /** 取消当前框（等价于「以取消语义回答」） */
  cancel(): void {
    this.answer(this.current?.kind === "text" ? null : false);
  }

  open(request: DialogRequest): void {
    this.stack.push(request);
    this.emit();
  }

  close(): void {
    this.stack.pop();
    this.emit();
  }

  closeAll(): void {
    this.stack.length = 0;
    const settle = this.settle;
    this.settle = undefined;
    this.emit();
    // 换工程/新建时清栈：挂起者以「取消」结算（不留悬挂的 Promise）
    settle?.(null);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Promise 化外观（组件消费面）：`askText` / `askConfirm` / `notify`。
 *
 * 判据留在 `parseTextAnswer`（纯函数、可测），这里只做**语义收窄**。
 */
export interface DialogPort {
  /** 返回 `null` = 取消；返回 `""` = 确定但无值 */
  askText(request: Omit<Extract<DialogRequest, { kind: "text" }>, "kind">): Promise<string | null>;
  /** `false` = 取消 */
  askConfirm(request: Omit<Extract<DialogRequest, { kind: "confirm" }>, "kind">): Promise<boolean>;
  /** 通知（无取消） */
  notify(request: Omit<Extract<DialogRequest, { kind: "notice" }>, "kind">): Promise<void>;
}

/** 把状态机接成 Promise 外观（渲染由宿主订阅 `state.subscribe`） */
export function createDialogPort(state: DialogHostState): DialogPort {
  return {
    async askText(request): Promise<string | null> {
      const raw = await state.ask({ kind: "text", ...request });
      return typeof raw === "string" ? raw : null;
    },
    async askConfirm(request): Promise<boolean> {
      const raw = await state.ask({ kind: "confirm", ...request });
      return raw === true;
    },
    async notify(request): Promise<void> {
      await state.ask({ kind: "notice", ...request });
    },
  };
}

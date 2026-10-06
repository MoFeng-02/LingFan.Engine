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
      /** 选项选择：点选项即提交（无「确定」按钮；Esc/遮罩 = 取消） */
      readonly kind: "choice";
      readonly title: string;
      readonly message?: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
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

/**
 * `askChoice` 的答案判据（与 `parseTextAnswer` 同构：取消语义集中一处）。
 * 只有**命中选项集**的字符串才执行；取消（Esc=false / 遮罩）与越界值一律**不执行**
 * ——越界值 fail-closed（渲染层 bug 不该变成「静默选了第一项」）。
 */
export function parseChoiceAnswer(
  answer: DialogAnswer,
  values: readonly string[],
): { run: false } | { run: true; value: string } {
  if (typeof answer !== "string") return { run: false }; // 取消/异常形态 ⇒ 不执行
  if (!values.includes(answer)) return { run: false }; // 越界 = 不执行，不兜底
  return { run: true, value: answer };
}

/** 对话框栈（支持嵌套：后进先出） */
export class DialogHostState {
  private readonly stack: DialogRequest[] = [];
  /**
   * 等待回答的结算器**与框一一对应**（`stack[i]` ↔ `settlers[i]`）。
   *
   * ⚠️ **为什么不能是单个槽位**（真缺陷，已被真机探针逮到）：`ask()` 若在已有
   * 挂起框时再被调用，单槽位会被**覆盖** ⇒ 前一个 Promise **永久挂起**（调用方的
   * `await` 永不返回），而 `answer()` 的 `stack.pop()` 只弹一帧 ⇒ **框留在栈顶、
   * 全屏遮罩永久挡住所有点击**（用户现象是「点什么都没反应」，与提示内容毫无关系）。
   *
   * 正确语义：**后进先出**——回答的永远是栈顶那个框，结算器随框同进同出。
   * 非栈顶的挂起者仍按「后进先出」依次被结算，不丢不吊死。
   */
  private readonly setters: ((raw: DialogAnswer) => void)[] = [];
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
    return new Promise((resolve) => {
      // ⚠️ 结算器**先入栈再 emit**：`emit` 同步跑监听器（宿主把 `current` 写进 ref
      // 触发 Vue 重渲染）。若顺序反过来，栈与结算器会有一瞬不一致——重渲染却读不到
      // 对应结算器，「框出现但点不掉」就不可能被排查出来。
      this.setters.push(resolve);
      this.stack.push(request);
      this.emit();
    });
  }

  /** 注入回答（组件调）⇒ 弹出**栈顶**框并结算它（后进先出） */
  answer(raw: DialogAnswer): void {
    const settle = this.setters.pop();
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
    this.setters.pop();
    this.stack.pop();
    this.emit();
  }

  closeAll(): void {
    // ⚠️ 顺序：先摘栈再结算——结算回调（`await` 之后的续行）可能同步再开框，
    // 那时 `stack` 必须是干净的空栈，否则会残留一层永远关不掉的遮罩。
    const settlers = this.setters.splice(0, this.setters.length);
    this.stack.length = 0;
    this.emit();
    // 换工程/新建时清栈：挂起者以「取消」结算（不留悬挂的 Promise）
    for (const settle of settlers) settle(null);
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
  /**
   * 选项选择：返回所选 `value`；`null` = 取消（含越界值 fail-closed）。
   * 泛型直通：调用方给出的 `options[].value` 字面量类型（如 `"game"|"menu"|"ui"`）
   * 原样出现在返回类型 —— 判据（parseChoiceAnswer）保证返回值 ∈ 选项集，
   * 调用方无需再断言。
   */
  askChoice<T extends string>(request: {
    readonly title: string;
    readonly message?: string;
    readonly options: readonly { readonly value: T; readonly label: string }[];
  }): Promise<T | null>;
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
    async askChoice<T extends string>(request: {
      readonly title: string;
      readonly message?: string;
      readonly options: readonly { readonly value: T; readonly label: string }[];
    }): Promise<T | null> {
      const raw = await state.ask({ kind: "choice", ...request });
      const parsed = parseChoiceAnswer(
        raw,
        request.options.map((option) => option.value),
      );
      // 判据保证 parsed.value ∈ 选项集（即 T）⇒ 断言安全；越界已被 fail-closed 拦下
      return parsed.run ? (parsed.value as T) : null;
    },
    async notify(request): Promise<void> {
      await state.ask({ kind: "notice", ...request });
    },
  };
}

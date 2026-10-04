/**
 * 视图状态模型：**加载 / 空 / 只读 / 错误 / 脏** 五态的单一判定。
 *
 * 为何是纯函数（可测）：「现在该显示什么」是**判据**，而判据最容易在模板里
 * 悄悄错（`v-if` 写反一个 ⇒ 加载中显示成"没有内容"）。集中判定后，
 * 每种状态都有一处可加断言的地方。
 *
 * 五态的**判定顺序即优先级**（错误 > 加载 > 空 > 无内容）：
 * 错误优先于一切——出错时不该同时说"加载中"或"暂无内容"，那是在**掩盖**失败。
 */

/** 资源视图的五态（`ready` = 正常可读） */
export type ViewState = "loading" | "empty" | "readonly" | "error" | "dirty" | "ready";

/** 判定入参（全部可选 ⇒ 缺省即「无特殊状态」） */
export interface ViewStateInput {
  /** 是否有读取中的异步操作在进行 */
  readonly loading?: boolean;
  /** 读取是否失败（`undefined` = 未失败；空串按失败处理——不谎报成功） */
  readonly error?: string | undefined;
  /** 内容是否为空（`true` = 没有任何条目） */
  readonly empty?: boolean;
  /** 内容是否只读 */
  readonly readonly?: boolean;
  /** 是否有未保存改动 */
  readonly dirty?: boolean;
}

/**
 * 五态判定。**错误最优先**——失败时如实报失败，不被"加载中/空"掩盖。
 *
 * ⚠️ `dirty` 不覆盖 `ready`：`ready + dirty` ⇒ 仍是 `ready`（可读且有改动），
 * 脏是**附加徽标**不是**内容状态**；只有「只读 + 脏」不可能 ⇒ 不会出现。
 */
export function viewStateOf(input: ViewStateInput): ViewState {
  if (input.error !== undefined && input.error !== "") return "error";
  if (input.loading === true) return "loading";
  if (input.readonly === true) return "readonly";
  if (input.empty === true) return "empty";
  if (input.dirty === true) return "dirty";
  return "ready";
}

/** 空态的**主动作**（规划稿 E5：空态必须给可点击的下一步，不是一行灰字） */
export interface EmptyAction {
  readonly id: "open-project" | "new-project" | "open-external" | "none";
  readonly label: string;
  /** 是否为主动作（视觉权重） */
  readonly primary?: boolean;
  readonly title: string;
  readonly hint: string;
}

/**
 * 空态口径表（按「为什么空」分类 —— **一个空字面意思有多种**，混成一句
 * "暂无内容"就是 D-62⑫ 说的「空态薄弱」）。
 */
export function emptyStateOf(reason: string): EmptyAction {
  switch (reason) {
    case "no-project":
      return {
        id: "open-project",
        label: "打开工程",
        primary: true,
        title: "未打开工程",
        hint: "选择工程的资源根目录（Resources/）开始编辑。",
      };
    case "no-matches":
      return {
        id: "none",
        label: "",
        title: "无匹配结果",
        hint: "换个关键词，或清空搜索条件。",
      };
    case "empty-resource":
      return {
        id: "open-external",
        label: "用外部编辑器打开",
        title: "该资源为空文件",
        hint: "内容为空——可用外部编辑器补充后再回来。",
      };
    case "read-only":
      return {
        id: "open-external",
        label: "用外部编辑器打开",
        primary: true,
        title: "只读资源",
        hint: "编辑器不提供编辑面；改动请到外部编辑器进行。",
      };
    default:
      return { id: "none", label: "", title: "暂无内容", hint: "" };
  }
}

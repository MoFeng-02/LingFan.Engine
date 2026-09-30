/**
 * 节点图连线建分支：**拉线语义的纯判定**——
 * DOM/事件留在组件（命中检测、临时线），落库语义只在这里（可测、fail-closed）。
 *
 * 语义（列名即标签，jump/menu 的目标都是列）：
 * - 源列必须是 **flow**（scene 列的 entry 命令流是展示/交互层，流程分支在 flow 列表达）；
 * - 目标列必须是 **flow** 且 ≠ 源（自连无意义；非法 → `null`，调用方给 fail-closed 提示）；
 * - 源列**最后一个 `menu`** → 在其 `options` 末尾追加选项（`text` 缺省「新选项」）；
 * - 否则 → `commands` 末尾追加 `{op:"jump", target}`。
 * 一次拉线 = 一次 `session.apply` = 一个 undo 单元（提交在宿主 api）。
 *
 */

/** 追加计划：`containerPointer` 相对列指针（如 `commands` / `commands/3/options`） */
export interface BranchPlan {
  kind: "jump" | "menu-option";
  containerPointer: string;
  index: number;
  /** menu 选项的预填文本（jump 无此字段） */
  text?: string;
  target: string;
}

/** 宽松列形状（编辑器 StoryColumn 兼容：字段缺失一律按「无」处理，不抛） */
export interface BranchColumnLike {
  id?: unknown;
  kind?: unknown;
  commands?: unknown;
}

/** 目标列是否可作为跳转/选项落点（scene 列是空间层，fail-closed 拒绝） */
export function isBranchTarget(column: BranchColumnLike | undefined): boolean {
  return column?.kind === "flow";
}

function isMenuCommand(command: unknown): boolean {
  return (
    typeof command === "object" &&
    command !== null &&
    (command as { op?: unknown }).op === "menu"
  );
}

/**
 * 拉线落库计划：非法组合（非 flow 源 / 自连）→ `null`；否则返回插入位置与预填值。
 * 只读列形状，不改任何数据（插入由宿主经 `insertAtPointer` 提交）。
 */
export function planBranchInsertion(
  column: BranchColumnLike | undefined,
  targetColumnId: string,
  optionText?: string,
): BranchPlan | null {
  if (column?.kind !== "flow" || typeof column.id !== "string") return null;
  if (column.id === targetColumnId) return null;
  const commands = Array.isArray(column.commands) ? column.commands : [];
  let lastMenuIndex = -1;
  commands.forEach((command, index) => {
    if (isMenuCommand(command)) lastMenuIndex = index;
  });
  if (lastMenuIndex >= 0) {
    const menu = commands[lastMenuIndex] as { options?: unknown };
    const options = Array.isArray(menu.options) ? menu.options : [];
    return {
      kind: "menu-option",
      containerPointer: `commands/${lastMenuIndex}/options`,
      index: options.length,
      text: optionText ?? "新选项",
      target: targetColumnId,
    };
  }
  return {
    kind: "jump",
    containerPointer: "commands",
    index: commands.length,
    target: targetColumnId,
  };
}

/**
 * 引用指针 → 命令指针（边点击选中用）：
 * `/columns/i/commands/j/target` → `/columns/i/commands/j`；
 * menu 选项 `/columns/i/commands/j/options/k/target` → 选中**整个 menu 命令**
 * （属性面板一次可见全部选项）；非命令字段指针原样返回（navigate 等未来形态）。
 */
export function branchPointerToCommand(pointer: string): string {
  const match = /^(\/columns\/\d+\/commands\/\d+)/.exec(pointer);
  return match === null ? pointer : match[1]!;
}

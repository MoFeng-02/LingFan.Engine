/**
 * 「+ 列」对话框返回值的**意图判定**（纯函数，可单测）。
 *
 * `window.prompt` 的三种返回值语义**互不相同**，混为一谈就会静默改工程：
 * - `null`  = 用户取消 / 按 Esc  ⇒ **不执行**（**不得当成"留空"**）
 * - `""`    = 用户确定但留空     ⇒ **执行**，id 交引擎兜底生成 `column-N`
 * - 非空串  = 用户给了建议 id    ⇒ **执行**，作为建议 id（trim / 不安全字符 / 重名
 *   由 `@lingfan/editor` 的 `suggestColumnId` 兜底唯一化）
 *
 * **为什么抽成纯函数**：组件里直接调 `window.prompt` 无法单测（jsdom 之外没有真实
 * 对话框语义与用户手势），但"取消 vs 留空"的判定是**纯逻辑** —— 抽出来即可用真值表
 * 锁定。此举针对 D-58：`ColumnList.vue` 的 `promptRename` / `promptAddGroup` 都写了
 * `=== null` 守卫，**唯独 `promptAddColumn` 漏掉**，用 `hint ?? undefined` 把取消与
 * 留空压成同一个值 ⇒ 按 Esc 却凭空多出一列。
 */
export interface AddColumnIntent {
  /** 是否执行新增 */
  run: boolean;
  /** 建议 id；`undefined` = 无建议（引擎按 `column-N` 兜底生成） */
  hint?: string;
}

/** 判定 `window.prompt` 返回值应当如何处置（取消不执行；留空执行但无建议；有值即建议） */
export function decideAddColumn(raw: string | null): AddColumnIntent {
  if (raw === null) return { run: false };
  return { run: true, hint: raw === "" ? undefined : raw };
}

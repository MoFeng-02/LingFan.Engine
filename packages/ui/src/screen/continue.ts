/**
 * 启动界面的「继续」按钮：从存档摘要里挑出该读哪一个槽。
 *
 * 为什么需要这一层：槽位清单由工程配置决定（`shell.saves.slots` → `slot_1..slot_N`），
 * 而「哪个槽最近存过」只有存档端口知道（`SavePort.list()`）。按钮要的是**一个槽名**
 * 或**没有槽**这两件事，中间的挑选规则归这里，三形态共用。
 *
 * 三条口径：
 * - **只认配置内的槽**：`list()` 可能返回历史遗留的槽名（改过槽位数的工程），
 *   不在当前清单里的一律不选——按钮跳到一个界面上根本看不见的槽是没法解释的行为。
 * - **按写入时间取最大**：`timestamp` 是毫秒时间戳；相同时间取清单里靠前的那个，
 *   保证同一份摘要集必得同一结果（否则「继续」会随机跳两个槽）。
 * - **没有可用摘要 = 按钮不可点**：空数组是合法返回值（不是错误），
 *   按钮置 `disabled` 并显示一行提示，不静默。
 */
import type { SlotSummary } from "@lingfan-engine/core";

/**
 * 挑出「继续」该读的槽。
 *
 * @param summaries 存档端口的摘要表（`SavePort.list()` 的结果，可能是空数组）。
 * @param slots 当前工程的槽名清单（`slotIds(resolveSavesConfig(manifest).slots)`）。
 * @returns 最近写入且在当前清单内的那条摘要；没有则 `undefined`。
 * @example
 * latestSave([{ slot: "slot_1", saveCount: 2, timestamp: 100, mode: "portable" }], ["slot_1", "slot_2"]);
 * // → slot_1 那条
 */
export function latestSave(
  summaries: readonly SlotSummary[],
  slots: readonly string[],
): SlotSummary | undefined {
  const allowed = new Set(slots);
  let best: SlotSummary | undefined;
  for (const summary of summaries) {
    if (!allowed.has(summary.slot)) continue;
    if (best === undefined || summary.timestamp > best.timestamp)
      best = summary;
  }
  return best;
}

/**
 * 「继续」按钮的可用状态：可读的槽名 + 要不要置灰。
 *
 * @param summaries 存档端口的摘要表。
 * @param slots 当前工程的槽名清单。
 * @returns `slot` 为 `undefined` 时按钮必须 `disabled`。
 */
export function continueSlot(
  summaries: readonly SlotSummary[],
  slots: readonly string[],
): { readonly slot: string | undefined } {
  const found = latestSave(summaries, slots);
  return { slot: found?.slot };
}

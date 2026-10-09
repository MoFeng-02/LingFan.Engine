/**
 * 历史面板的数据整形：引擎给出的历史条目 → 可直接渲染的块列表。
 *
 * 连续 NVL 条目聚合成一个块——玩家所见本来就是整块累积画面，块级回溯 =
 * 回到「块尾检查点」（整块可见的时刻，检查点语义的自然延伸）；buffer 收缩
 * （nvl clear）即分段。回溯粒度不减：逐检查点仍全在历史里，只是呈现聚合。
 */

/** 一条历史条目（引擎 `historyView` 的行） */
export interface HistoryEntry {
  /** 回溯目标：引擎检查点序号 */
  index: number;
  /** 说话人（空串 = 无） */
  speaker: string;
  /** 正文（非 NVL 模式下的一行） */
  text: string;
  /** 是否 NVL 累积模式下的行 */
  nvl: boolean;
  /** NVL 模式下的整块行（回溯目标为块尾） */
  nvlLines: string[];
}

/** 呈现块：连续 NVL 聚合后的一行 */
export interface HistoryBlock {
  /** 块首条目 index（稳定，避免重建） */
  key: string;
  /** 回溯目标 = 块尾检查点 */
  index: number;
  speaker: string;
  /** 该块要显示的正文行 */
  lines: string[];
  nvl: boolean;
}

/** 丢掉说话人与正文都空的行（不构成一次可回溯的呈现） */
export function filterHistoryEntries(
  entries: readonly HistoryEntry[],
): HistoryEntry[] {
  return entries.filter((h) => h.text !== "" || h.speaker !== "");
}

/** 把历史条目聚合成呈现块 */
export function buildHistoryBlocks(
  entries: readonly HistoryEntry[],
): HistoryBlock[] {
  const blocks: HistoryBlock[] = [];
  for (const entry of entries) {
    const prev = blocks[blocks.length - 1];
    // 同段延续：块尾推进为最新检查点；行数变少说明 buffer 已收缩（分段）
    if (
      entry.nvl &&
      prev?.nvl === true &&
      entry.nvlLines.length >= prev.lines.length
    ) {
      prev.index = entry.index;
      prev.lines = entry.nvlLines;
      continue;
    }
    blocks.push({
      key: `blk-${entry.index}`,
      index: entry.index,
      speaker: entry.speaker,
      lines: entry.nvl ? [...entry.nvlLines] : [entry.text],
      nvl: entry.nvl,
    });
  }
  return blocks;
}

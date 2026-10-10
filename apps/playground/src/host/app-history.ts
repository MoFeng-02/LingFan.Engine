/**
 * 历史聚合的宿主侧装配：引擎快照经筛选成为可回溯条目，连续 NVL 行聚合成呈现块，
 * 回溯目标是块尾检查点。历史面板只是回溯的 UI 皮——核心层只暴露坐标回溯。
 */

import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { StoryEngine } from "@lingfan/engine";
import {
  buildHistoryBlocks,
  filterHistoryEntries,
  type HistoryBlock,
  type HistoryEntry,
} from "./history-panel";

/** 装配入参：引擎句柄取用与回放后的渲染同步 */
export interface AppHistoryOptions {
  /** 引擎句柄取用（快照读取与坐标回溯） */
  getEngine: () => StoryEngine;
  /** 回放后渲染状态与引擎对齐（回溯重写了对话与 NVL 系统键） */
  syncFromEngine: () => void;
}

/** 历史面板能力：显隐、呈现块视图、开关与按坐标回溯 */
export interface AppHistory {
  /** 历史面板显隐 */
  showHistory: Ref<boolean>;
  /** 呈现块：连续 NVL 聚合成一行，回溯目标是块尾检查点 */
  historyBlocks: ComputedRef<HistoryBlock[]>;
  /** 开合面板；打开时刷新引擎快照 */
  toggleHistory: () => void;
  /** 回溯到指定条目并收起面板 */
  rollbackToEntry: (index: number) => void;
}

/** 装配历史聚合：快照筛选、NVL 块化与回溯收口 */
export function createAppHistory(options: AppHistoryOptions): AppHistory {
  const { getEngine, syncFromEngine } = options;
  const showHistory = ref(false);
  /** 历史条目（引擎快照经筛选后的可回溯行；打开面板时刷新） */
  const historyEntries = ref<HistoryEntry[]>([]);
  /** 呈现块：连续 NVL 聚合成一行，回溯目标是块尾检查点 */
  const historyBlocks = computed<HistoryBlock[]>(() =>
    buildHistoryBlocks(historyEntries.value),
  );
  /** 打开历史面板时刷新快照（历史面板是回溯的 UI 皮） */
  function refreshHistory(): void {
    historyEntries.value = filterHistoryEntries(getEngine().historyView());
  }
  function toggleHistory(): void {
    showHistory.value = !showHistory.value;
    if (showHistory.value) refreshHistory();
  }
  function rollbackToEntry(index: number): void {
    getEngine().rollbackTo(index);
    showHistory.value = false;
    syncFromEngine();
  }
  return { showHistory, historyBlocks, toggleHistory, rollbackToEntry };
}

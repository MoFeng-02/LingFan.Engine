/**
 * 历史面板（纯 DOM）：已走过的对话按「呈现块」列出，点一块就回退到那个检查点。
 *
 * 两件事分开，与偏好面板同一口径：
 * - **数据整形**归 `@lingfan-engine/shell` 的 `filterHistoryEntries` / `buildHistoryBlocks`
 *   （连续 NVL 聚成一块，回溯粒度仍是逐检查点）。本模块不自己聚合——那套规则若在
 *   宿主里另写一份，「面板显示的行」与「回溯落点」迟早对不上。
 * - **本模块只管**：把块列表画进容器、把点击翻译成 `engine.rollbackTo(index)`。
 *
 * 回溯本身是引擎命令面（`rollbackTo` / `back` / `forward`），宿主不重放、不改状态。
 * 回溯完成后的媒体对齐不在引擎里（它只回状态、不下发端口动作），所以本模块留了一个
 * `onRollback` 出口给组合根接媒体同步——这是宿主的职责，不是面板的。
 *
 * 面板自带开关按钮：容器是可选的（叠加层可以不给 `#history`），若把开关放在工具条里，
 * 那道槽位就变强制了。放在容器内则「有容器才有历史 UI」，与 `#prefs` 同口径。
 */

import {
  buildHistoryBlocks,
  filterHistoryEntries,
  type HistoryBlock,
  type HistoryEntry,
} from "@lingfan-engine/shell";

/** 历史面板需要的引擎能力（只读历史 + 坐标回溯，不含推进） */
export interface HistoryEngine {
  /** 逐检查点的历史条目 */
  historyView(): readonly HistoryEntry[];
  /** 回溯到第 index 个检查点 */
  rollbackTo(target: number): void;
}

/** 面板当前应显示的视图值（纯数据，测试断言这一层） */
export interface HistoryPanelView {
  /** 面板是否展开 */
  open: boolean;
  /** 呈现块（连续 NVL 已聚合） */
  blocks: HistoryBlock[];
}

/** 历史面板的输入 */
export interface HistoryPanelOptions {
  /** 引擎（读历史、执行回溯） */
  engine: HistoryEngine;
  /** 面板容器（由调用方给，本模块不自己 append 到 body） */
  container: HTMLElement;
  /**
   * 回溯完成后的宿主侧收尾（可选）：媒体位置需显式对齐——引擎 `rollback.done`
   * 只带坐标，播放器不会自己跳回去。与 `wireEngine` 的 `syncMedia` 是同一件事。
   */
  onRollback?(): void;
}

/** 历史面板出口 */
export interface HistoryPanel {
  /** 面板当前应显示的视图值；每次现读引擎历史 */
  view(): HistoryPanelView;
  /** 展开并重画（重复调用幂等） */
  open(): void;
  /** 收起 */
  close(): void;
  /** 展开 ↔ 收起 */
  toggle(): void;
  /** 回退到某个检查点：回溯 + 收起 + 宿主收尾 */
  rollbackTo(index: number): void;
  /** 挂载控件与监听（重复调用幂等，不叠控件） */
  mount(): void;
  /** 卸载：清空容器并断开引用；之后可再次 `mount()` */
  destroy(): void;
}

/**
 * 创建历史面板。构造只持有引擎与容器，不碰 DOM——`mount()` 才建控件，
 * 因此未挂载的面板可以安全地只调 `view()`（视图计算与 DOM 解耦）。
 */
export function createHistoryPanel(options: HistoryPanelOptions): HistoryPanel {
  const { engine, container } = options;

  /** 非 null = 已挂载；同时充当容器根节点句柄 */
  let root: HTMLElement | null = null;
  let list: HTMLElement | null = null;
  let toggleButton: HTMLButtonElement | null = null;
  let openState = false;

  function view(): HistoryPanelView {
    const blocks = buildHistoryBlocks(
      filterHistoryEntries(engine.historyView()),
    );
    return { open: openState, blocks };
  }

  /** 一次块渲染：一级按钮 = 一个块，点它即回溯到块尾检查点 */
  function renderBlocks(): void {
    if (list === null) return;
    list.textContent = ""; // 整体重建：块数不多，重建比逐块 diff 简单且不会残留
    const { blocks } = view();
    for (const block of blocks) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "history-item";
      // 回溯目标是**块尾**检查点，标在节点上便于宿主排查与测试取证
      item.dataset.index = String(block.index);
      if (block.speaker !== "") {
        const speaker = document.createElement("span");
        speaker.className = "history-speaker";
        speaker.textContent = block.speaker;
        item.appendChild(speaker);
      }
      for (const line of block.lines) {
        const text = document.createElement("span");
        text.className = block.nvl
          ? "history-text history-nvl"
          : "history-text";
        text.textContent = line;
        item.appendChild(text);
      }
      item.addEventListener("click", () => {
        rollbackTo(block.index);
      });
      list.appendChild(item);
    }
  }

  /** 展开态落到 DOM：列表显隐 + 按钮文案 */
  function applyOpen(): void {
    if (list !== null) list.style.display = openState ? "" : "none";
    if (toggleButton !== null)
      toggleButton.textContent = openState ? "关闭历史" : "历史";
  }

  function open(): void {
    openState = true;
    renderBlocks();
    applyOpen();
  }

  function close(): void {
    openState = false;
    applyOpen();
  }

  function toggle(): void {
    if (openState) close();
    else open();
  }

  function rollbackTo(index: number): void {
    // 引擎 fail-closed：越界、重放中都会自己报错，这里只管把面板收起来
    engine.rollbackTo(index);
    // 回溯改了状态，但面板若还开着，接下来点哪一块都基于旧列表——收起最省事
    close();
    options.onRollback?.();
  }

  function mount(): void {
    if (root !== null) return; // 已挂载：幂等，重复调用不重复建控件
    container.dataset.uiZone = "";
    const section = document.createElement("section");
    section.className = "history-panel";
    section.dataset.uiZone = "";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-toggle";
    button.textContent = "历史";
    button.addEventListener("click", () => {
      toggle();
    });
    section.appendChild(button);

    const blockList = document.createElement("div");
    blockList.className = "history-list";
    blockList.style.display = "none";
    section.appendChild(blockList);

    container.appendChild(section);
    root = section;
    list = blockList;
    toggleButton = button;
    openState = false;
    applyOpen();
  }

  function destroy(): void {
    container.textContent = "";
    root = null;
    list = null;
    toggleButton = null;
    openState = false;
  }

  return { view, open, close, toggle, rollbackTo, mount, destroy };
}

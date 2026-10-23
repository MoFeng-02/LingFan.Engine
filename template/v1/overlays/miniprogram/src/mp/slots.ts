/**
 * 存档入口的宿主侧装配：槽位视图与存读点选。
 *
 * 槽位数、「空槽能不能点」这些判据都在壳层与引擎（`@lingfan-engine/shell` / `@lingfan-engine/core`），
 * 本文件只做两件事：按工程清单的槽数拉一次逐槽视图，把面板上的点选翻成存/读命令。
 * 规则不在这里另写一份——槽位 id 生成与桌面宿主同源，改规则只改那一处。
 *
 * 本文件不碰平台全局与框架：面板由页面渲染，这里只产出数据与回执，Node 下可直测。
 */
import { slotIds, type SavePort } from "@lingfan-engine/core";
import {
  canChooseSlot,
  loadSlotViews,
  type SlotPanelMode,
  type SlotView,
} from "@lingfan-engine/shell";

export type { SlotPanelMode, SlotView };
/** 空槽判据随出口一起给页面用：槽位能不能点全仓只有壳层这一份规则 */
export { canChooseSlot };

/** 槽位视图的取数参数 */
export interface HostSlotViewsOptions {
  /** 存档端口（清单与逐槽读取） */
  savePort: SavePort;
  /** 槽位数量（工程清单 `shell.saves.slots`，内建默认见引擎） */
  slots: number;
}

/** 拉取面板要的逐槽视图：打开面板时调一次 */
export function loadHostSlotViews(
  options: HostSlotViewsOptions,
): Promise<SlotView[]> {
  // 槽位 id 由引擎的唯一规则生成：`slot_1..slot_N`（与 Rust 侧存储命名兼容）
  return loadSlotViews({
    savePort: options.savePort,
    slotIds: slotIds(options.slots),
  });
}

/** 存读点选参数：命令回调由宿主句柄注入（引擎归组合根） */
export interface ChooseHostSlotOptions {
  /** 面板当前模式（未打开时为 null） */
  mode: SlotPanelMode | null;
  /** 被点选的槽位 */
  view: SlotView;
  /** 写入存档（`engine.save`） */
  save(slot: string): boolean;
  /** 读取存档（`engine.load`） */
  load(slot: string): boolean;
}

/**
 * 按当前模式执行点选。
 *
 * 回执 = 命令是否被接受（读档真正落地晚于返回：媒体对齐挂在引擎的 `load.done` 事件上）。
 * 空槽在读档模式下直接不执行——引擎读不到档也是 fail-closed，但让玩家先点一次再收一条
 * 提示没有意义；判据与桌面面板同一份（`canChooseSlot`）。
 */
export function chooseHostSlot(options: ChooseHostSlotOptions): boolean {
  if (!canChooseSlot(options.view, options.mode)) return false;
  if (options.mode === "save") return options.save(options.view.id);
  return options.load(options.view.id);
}

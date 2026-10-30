/**
 * 一屏的渲染输入：把「此刻该渲染哪一屏、这一屏上有什么可点的」折成一份只读数据，
 * 交给各形态自己去画。
 *
 * 为什么要折成数据：引擎不认识「启动界面」这个概念，它只知道自己进了哪一列、
 * 那一列是什么类型。屏幕切换是宿主的事，而三形态的画法完全不同——原生造 DOM、
 * Vue / React 交组件。宿主只负责判定与命令，画法归各形态的组合根。
 *
 * 这份膜刻意把命令（进入游戏、读档）也带上：形态只需绑到自己的按钮上，
 * 不必知道入口列从哪来、存档槽叫什么。
 */
import type { SlotSummary } from "@lingfan-engine/core";
import { continueSlot } from "./continue.ts";
import { hostScreenOf, type HostScreen } from "./model.ts";

/**
 * 「继续」按钮的可用状态。
 *
 * `reason` 与 `slot` 一一对应：可继续时 `reason` 是空串，不可继续时 `slot` 是
 * `undefined`——两者不会同时有值，形态据此决定按钮是绑定动作还是显示提示。
 */
export interface ContinueHint {
  /** 最近写入的槽名；`undefined` 表示没有任何可用存档 */
  readonly slot: string | undefined;
  /** 不可继续时显示的一行说明；可继续时为空串 */
  readonly reason: string;
}

/** 一组渲染输入：哪一屏、画什么、按什么做什么 */
export interface ScreenView {
  /** 此刻该渲染哪一屏 */
  readonly screen: HostScreen;
  /** 工程展示名 */
  readonly title: string;
  /** 存档槽名表（与工具条下拉框同源） */
  readonly slots: readonly string[];
  /** 「继续」的可点状态 */
  readonly resume: ContinueHint;
  /** 进入游戏 */
  start(): void;
  /** 读某个槽 */
  load(slot: string): void;
}

/** 组装一份渲染输入所需的外部事实与命令 */
export interface ScreenViewInput {
  /** 当前列 id（尚未进入任何列时为空串） */
  readonly columnId: string;
  /** 当前列类型（引擎在未进列时按 `game` 报，故判定必须与列 id 一起看） */
  readonly columnType: string;
  /** 工程展示名 */
  readonly title: string;
  /** 存档槽名表 */
  readonly slots: readonly string[];
  /** 存档摘要（空数组表示无档，是合法返回值不是错误） */
  readonly saves: readonly SlotSummary[];
  /** 进入游戏 */
  readonly start: () => void;
  /** 读某个槽 */
  readonly load: (slot: string) => void;
}

/**
 * 把外部事实与命令折成一份渲染输入。
 *
 * @param input 当前列两件事实、工程展示名、槽名表、存档摘要，以及两个命令。
 * @returns 渲染输入（见 {@link ScreenView}）。
 * @example
 * screenViewOf({ columnId: "", columnType: "game", title: "示例", slots: ["slot_1"], saves: [], start, load });
 * // → { screen: "start", resume: { slot: undefined, reason: "还没有存档，先开始一局" }, ... }
 */
export function screenViewOf(input: ScreenViewInput): ScreenView {
  const { slot } = continueSlot(input.saves, input.slots);
  return {
    screen: hostScreenOf({
      columnId: input.columnId,
      columnType: input.columnType,
    }),
    title: input.title,
    slots: input.slots,
    resume:
      slot === undefined
        ? { slot: undefined, reason: "还没有存档，先开始一局" }
        : { slot, reason: "" },
    start: input.start,
    load: input.load,
  };
}

/**
 * 两份渲染输入是否等价：屏、工程名、槽名表、「继续」指向的槽。
 *
 * 不比命令（每次都可能是新的闭包）也不比 `reason`（它由 `slot` 唯一决定）——
 * 比出不等价就广播，形态据此重画。
 *
 * @param left 上一份
 * @param right 新一份
 * @returns 等价返回 `true`
 */
export function sameScreenView(left: ScreenView, right: ScreenView): boolean {
  if (left.screen !== right.screen) return false;
  if (left.title !== right.title) return false;
  if (left.resume.slot !== right.resume.slot) return false;
  if (left.slots.length !== right.slots.length) return false;
  return left.slots.every((slot, index) => slot === right.slots[index]);
}

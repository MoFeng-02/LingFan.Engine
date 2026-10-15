/**
 * 提示条编排：把「说什么、什么语气、停留多久」收成一处。
 *
 * 驻留时长是宿主策略而非引擎状态，四档默认值按用途分开（通知供阅读最长、操作反馈最短、
 * 读档提示多留一档、回溯提示与反馈同档），由装配方注入——数值本身不在这里定死。
 *
 * 计时器到点即把对应条目从列表里摘掉，所以 `items` 里只留仍在驻留的提示；
 * 模板按 `id` 做 key，摘除时不会误伤同文案的另一条。
 *
 * 存/读文案里的槽位名与槽位面板同一个来源（`labelFor`，缺省到面板的显示名规则）：
 * 面板上写「槽位 1」，提示条也必须写「槽位 1」，不能退回槽位 id。
 *
 * 本模块平台无关：状态放在调用方传入的 Cell 里，定时器走注入的 TimerPort，
 * 不直接触碰任何框架或宿主全局。
 */
import { hostTimer, type TimerPort } from "@lingfan/engine";
import {
  DEFAULT_ACTION_TOAST_MS,
  DEFAULT_LOAD_TOAST_MS,
  DEFAULT_NOTIFY_MS,
  DEFAULT_ROLLBACK_NOTICE_MS,
  toNotifyTone,
  type NotifyTone,
} from "@lingfan/ui";
import type { Cell } from "../cell";
import { defaultSlotLabel } from "../panel/slots";

/**
 * 提示文案缺省模板：宿主可用文案选项逐句覆盖（本地化/改写均走这里）。
 *
 * 槽位名一律经 `labelFor` 渲染，缺省与槽位面板同源（`defaultSlotLabel`）——
 * 玩家在面板上点的是「槽位 1」，提示条就不该说 `slot_1`。
 */
function defaultTexts(labelFor: (id: string) => string): Required<NoticeTexts> {
  return {
    /** 存档完成 */
    saved: (slot: string): string => `已保存到 ${labelFor(slot)}`,
    /** 读档完成（含状态说明） */
    loaded: (slot: string): string =>
      `已读取 ${labelFor(slot)}（回到存档时刻）`,
    /** 回溯完成 */
    rollbackDone: (): string => "已回溯",
  };
}

/** 可覆盖的提示文案（逐句可选；未给的句子用缺省模板） */
export interface NoticeTexts {
  /** 存档完成（参数 = 槽位 id） */
  saved?(slot: string): string;
  /** 读档完成（参数 = 槽位 id） */
  loaded?(slot: string): string;
  /** 回溯完成 */
  rollbackDone?(): string;
}

/** 一条提示：`id` 唯一（同文案可并存多条），`tone` 决定皮肤类 */
export interface Notice {
  id: number;
  text: string;
  tone: NotifyTone;
}

/** 提示条编排需要的外部事实：状态落点与定时能力 */
export interface NoticeOptions {
  /** 提示列表落点（仍在驻留的条目，按 id 唯一）；缺省 = 模块自持普通 Cell */
  items?: Cell<Notice[]>;
  /** 定时器（驻留到期摘除）；缺省 = 宿主内建定时器 */
  timer?: TimerPort;
  /** `notify` 未自带 duration 时的驻留 */
  notifyDurationMs?: number;
  /** 操作反馈（存/读按钮等）的驻留 */
  toastDurationMs?: number;
  /** 读档完成提示的驻留 */
  loadToastDurationMs?: number;
  /** 「已回溯」轻提示的驻留 */
  rollbackNoticeDurationMs?: number;
  /**
   * 槽位显示名：把提示条里的槽位 id 变成玩家看得懂的称呼。
   * 缺省 = 槽位面板的显示名规则（`defaultSlotLabel`）；宿主自定义命名时，
   * 应与 `SlotPanelOptions.labelFor` 传同一个函数，好让两处叫法一致。
   */
  labelFor?(id: string): string;
  /** 可覆盖的提示文案（本地化/改写入口）；缺省 = 内置中文缺省模板 */
  texts?: NoticeTexts;
}

/** 提示条出口：列表供模板渲染，其余方法各自负责一句话的装配与驻留 */
export interface Notices {
  readonly items: Cell<Notice[]>;
  /** 通用投递：显式给时长与语气 */
  push(text: string, tone: NotifyTone, durationMs: number): void;
  /** 引擎 `notify` 事件：语气由 `notifyType` 归一，时长缺省走通知档 */
  notify(
    text: string,
    notifyType: unknown,
    durationMs: number | undefined,
  ): void;
  /** 操作反馈：语气缺省 info，时长缺省走反馈档 */
  toast(text: string, durationMs?: number, tone?: NotifyTone): void;
  /** 存档完成 */
  saved(slot: string): void;
  /** 读档完成（文案含状态说明，故用读档档时长） */
  loaded(slot: string): void;
  /** 回溯完成 */
  rollbackDone(): void;
  /** 引擎侧的读档诊断（非致命，宿主应知情） */
  loadNotice(text: string): void;
}

/**
 * 创建提示条编排。`items` 由调用方持有——框架宿主传响应式 Cell，模板随写随渲染；
 * 未传 `items` 也可独立使用（内部持有普通 Cell，供无渲染场景或测试）。
 * 定时器经 TimerPort 注入，驻留摘除对调用方透明。
 */
export function createNotices(options: NoticeOptions = {}): Notices {
  const items: Cell<Notice[]> = options.items ?? { value: [] };
  const notifyDurationMs = options.notifyDurationMs ?? DEFAULT_NOTIFY_MS;
  const toastDurationMs = options.toastDurationMs ?? DEFAULT_ACTION_TOAST_MS;
  const loadToastDurationMs =
    options.loadToastDurationMs ?? DEFAULT_LOAD_TOAST_MS;
  const rollbackNoticeDurationMs =
    options.rollbackNoticeDurationMs ?? DEFAULT_ROLLBACK_NOTICE_MS;
  const texts: Required<NoticeTexts> = {
    ...defaultTexts(options.labelFor ?? defaultSlotLabel),
    ...options.texts,
  };
  const timer: TimerPort = options.timer ?? hostTimer;

  let seq = 0;

  const push = (text: string, tone: NotifyTone, durationMs: number): void => {
    const id = ++seq;
    items.value = [...items.value, { id, text, tone }];
    timer.set(() => {
      items.value = items.value.filter((n) => n.id !== id);
    }, durationMs);
  };

  return {
    items,
    push,
    notify(
      text: string,
      notifyType: unknown,
      durationMs: number | undefined,
    ): void {
      push(text, toNotifyTone(notifyType), durationMs ?? notifyDurationMs);
    },
    toast(
      text: string,
      durationMs: number = toastDurationMs,
      tone: NotifyTone = "info",
    ): void {
      push(text, tone, durationMs);
    },
    saved(slot: string): void {
      push(texts.saved(slot), "info", toastDurationMs);
    },
    loaded(slot: string): void {
      push(texts.loaded(slot), "info", loadToastDurationMs);
    },
    rollbackDone(): void {
      push(texts.rollbackDone(), "info", rollbackNoticeDurationMs);
    },
    loadNotice(text: string): void {
      push(text, "warning", rollbackNoticeDurationMs);
    },
  };
}

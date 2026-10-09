/**
 * 提示条装配与驻留：把「说什么、什么语气、停留多久」收成一处。
 *
 * 驻留时长是宿主策略而非引擎状态，四档默认值按用途分开（通知供阅读最长、操作反馈最短、
 * 读档提示多留一档、回溯提示与反馈同档），由组合根注入——数值本身不在这里定死。
 *
 * 计时器到点即把对应条目从列表里摘掉，所以 `items` 里只留仍在驻留的提示；
 * 模板按 `id` 做 key，摘除时不会误伤同文案的另一条。
 */
import { ref, type Ref } from "vue";
import {
  DEFAULT_LOAD_TOAST_MS,
  DEFAULT_NOTIFY_MS,
  DEFAULT_ROLLBACK_NOTICE_MS,
  DEFAULT_VUE_TOAST_MS,
  toNotifyTone,
  type NotifyTone,
} from "@lingfan/ui";

/** 一条提示：`id` 唯一（同文案可并存多条），`tone` 决定皮肤类 */
export interface Notice {
  id: number;
  text: string;
  tone: NotifyTone;
}

/** 四档驻留时长；省略即用该用途的默认值 */
export interface NoticeOptions {
  /** `notify` 未自带 duration 时的驻留 */
  notifyDurationMs?: number;
  /** 操作反馈（存/读按钮等）的驻留 */
  toastDurationMs?: number;
  /** 读档完成提示的驻留 */
  loadToastDurationMs?: number;
  /** 「已回溯」轻提示的驻留 */
  rollbackNoticeDurationMs?: number;
}

/** 提示条出口：列表供模板渲染，其余方法各自负责一句话的装配与驻留 */
export interface Notices {
  readonly items: Ref<Notice[]>;
  /** 通用投递：显式给时长与语气 */
  push(text: string, tone: NotifyTone, durationMs: number): void;
  /** 引擎 `notify` 事件：语气由 `notifyType` 归一，时长缺省走通知档 */
  notify(text: string, notifyType: unknown, durationMs: number | undefined): void;
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
 * 创建提示条出口。返回的 `items` 是响应式列表，可直接绑到模板的 `v-for`。
 */
export function createNotices(options: NoticeOptions = {}): Notices {
  const notifyDurationMs = options.notifyDurationMs ?? DEFAULT_NOTIFY_MS;
  const toastDurationMs = options.toastDurationMs ?? DEFAULT_VUE_TOAST_MS;
  const loadToastDurationMs = options.loadToastDurationMs ?? DEFAULT_LOAD_TOAST_MS;
  const rollbackNoticeDurationMs =
    options.rollbackNoticeDurationMs ?? DEFAULT_ROLLBACK_NOTICE_MS;

  const items = ref<Notice[]>([]);
  let seq = 0;

  const push = (text: string, tone: NotifyTone, durationMs: number): void => {
    const id = ++seq;
    items.value.push({ id, text, tone });
    setTimeout(() => {
      items.value = items.value.filter((n) => n.id !== id);
    }, durationMs);
  };

  return {
    items,
    push,
    notify(text: string, notifyType: unknown, durationMs: number | undefined): void {
      push(text, toNotifyTone(notifyType), durationMs ?? notifyDurationMs);
    },
    toast(text: string, durationMs: number = toastDurationMs, tone: NotifyTone = "info"): void {
      push(text, tone, durationMs);
    },
    saved(slot: string): void {
      push(`已保存到 ${slot}`, "info", toastDurationMs);
    },
    loaded(slot: string): void {
      push(`已读取 ${slot}（回到存档时刻）`, "info", loadToastDurationMs);
    },
    rollbackDone(): void {
      push("已回溯", "info", rollbackNoticeDurationMs);
    },
    loadNotice(text: string): void {
      push(text, "warning", rollbackNoticeDurationMs);
    },
  };
}

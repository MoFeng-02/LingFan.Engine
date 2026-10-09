/**
 * 宿主表现的行业默认节律（具名导出，**不承担「统一默认值」职责**）。
 *
 * 两个参考宿主的实际取值并不相同：Vue 参考宿主用 1500/2500/3000 ms 与各自的偏好速度，
 * 原生 DOM 模板宿主用 2600 ms 与 30 cps。所以这里只给「同一件事的默认叫什么名字」，
 * 由各自宿主把自己原本的字面量作为参数传进来——同源的是**声明**，不是取值。
 */

/** 文字推进的默认速度（可见字符/秒）：故事未声明 `text_typewriter` 速度时的兜底 */
export const DEFAULT_TEXT_CPS = 30;

/** 提示条默认驻留时长（毫秒） */
export const DEFAULT_TOAST_MS = 2600;

/** 通知默认驻留时长（毫秒）：`notify` 未自带 duration 时的兜底，最长一档 */
export const DEFAULT_NOTIFY_MS = 3000;

/** 操作反馈轻提示默认驻留时长（毫秒）：存/读按钮等即时反馈 */
export const DEFAULT_VUE_TOAST_MS = 1500;

/** 读档完成提示默认驻留时长（毫秒）：文案含状态说明，比即时反馈多留一档 */
export const DEFAULT_LOAD_TOAST_MS = 2500;

/** 回溯轻提示默认驻留时长（毫秒）：与即时反馈同档 */
export const DEFAULT_ROLLBACK_NOTICE_MS = 1500;

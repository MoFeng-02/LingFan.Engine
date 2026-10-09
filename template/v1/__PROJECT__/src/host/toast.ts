/**
 * 提示条：往通知层追加一条 toast，到点自己消失。
 *
 * 驻留时长是**可配置参数**，由调用方具名传入（不传则取展示层的默认名，其值即本宿主的
 * 现状取值）；写死在模块里会让「换一个宿主」变成改共享代码。
 */

import { DEFAULT_TOAST_MS } from "@lingfan/ui";
import type { StageDom } from "./stage-dom";

/** 提示函数的输入：通知层句柄与驻留毫秒数（缺省 = 展示层默认时长） */
export interface ToastOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 驻留毫秒数；缺省 = 展示层给出的默认时长 */
  durationMs?: number;
}

/** 创建提示函数：多次调用互不影响，各条各自计时 */
export function createToast(options: ToastOptions): (text: string) => void {
  const durationMs = options.durationMs ?? DEFAULT_TOAST_MS;
  return (text: string): void => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    options.dom.notifications.append(toast);
    window.setTimeout(() => toast.remove(), durationMs);
  };
}

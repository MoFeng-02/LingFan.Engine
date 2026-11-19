/**
 * 扩展等待覆盖层（原生 DOM 落法）：把展示态值格画成「确认即解除」的挂起画面。
 *
 * 展示态编排与模板共用 `@lingfan-engine/ui` 的 `createExtensionMountHandler` 一份；
 * 本文件只负责把值格里的展示态画进容器，并在「确认」时成对撤销订阅 + 经
 * `engine.resolveExtensionOp` 解除等待。中断（回溯/导航/读档/销毁）由编排层 abort
 * 清空值格，这里随之移除覆盖层——两条结束路径都收在渲染这一处。
 */
import type { ExtensionOpResult } from "@lingfan-engine/core";
import {
  createExtensionMountHandler,
  type ExtensionMountHandler,
  type ExtensionOverlay,
} from "@lingfan-engine/ui";

/** 覆盖层装配输入：落点容器、解除入口、宿主静态文案查表 */
export interface ExtensionOverlayOptions {
  /** 覆盖层落点（住宿主 UI 层，按窗口像素排布） */
  container: HTMLElement;
  /** 解除等待（引擎继续）；「确认」以成功收束 */
  resolveExtensionOp(op: string, result: ExtensionOpResult): void;
  /** 宿主静态文案查表（缺省恒等 = 原文直出） */
  translate?: (text: string) => string;
}

/** 造扩展等待覆盖层：返回挂载分支处理器（组合根把 `extension.mount` 事件交给它） */
export function createExtensionOverlay(
  options: ExtensionOverlayOptions,
): ExtensionMountHandler {
  const t = options.translate ?? ((text: string): string => text);
  let current: ExtensionOverlay | null = null;
  let node: HTMLElement | null = null;

  function render(): void {
    node?.remove();
    node = null;
    if (current === null) return;
    const overlay = current;
    const card = document.createElement("div");
    card.className = "extension-overlay";
    // 控件域标记：覆盖层里的按钮自己消费点击，不穿透成舞台推进
    card.dataset.uiZone = "";
    const title = document.createElement("p");
    title.textContent = overlay.title;
    card.append(title);
    if (overlay.detail !== "") {
      const detail = document.createElement("p");
      detail.textContent = overlay.detail;
      card.append(detail);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("完成");
    button.setAttribute("aria-label", t("完成扩展等待"));
    button.addEventListener("click", () => {
      handler.abort();
      current = null;
      render();
      options.resolveExtensionOp(overlay.op, { outcome: "success" });
    });
    card.append(button);
    options.container.append(card);
    node = card;
  }

  // 值格的 setter 即渲染入口：编排层置展示态 / abort 清空都经此落到 DOM
  const cell = {
    get value(): ExtensionOverlay | null {
      return current;
    },
    set value(next: ExtensionOverlay | null) {
      current = next;
      render();
    },
  };
  const handler = createExtensionMountHandler({ overlay: cell });
  return handler;
}

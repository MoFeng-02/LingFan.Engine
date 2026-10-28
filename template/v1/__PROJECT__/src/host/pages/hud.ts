/**
 * HUD 面板（宿主侧）：挂在游戏画面上方的常驻叠加层壳。
 *
 * **HUD 与页面是两回事**：页面是占满视口的整屏界面，切走即**销毁**；HUD 是叠加层，
 * 玩家随时可能再打开，销毁重建会丢内部状态（滚动位置、展开的分组），所以它的显隐是
 * **可见性**而不是生命周期——隐藏时实例存活、`mount` 不会被重复调用。
 * 本模块因此**不提供页面那种「切走即销毁」的语义**，只提供显隐与一次性销毁。
 *
 * 壳本身不决定内容：它在容器里建一个根节点，把 `data-ui-zone` 标记到容器与根节点上，
 * 再把可见性映射成根节点的 `hidden` 属性。`hidden` 只写在根节点、不写容器——容器由
 * 调用方持有，里面可能还有调用方自己的东西，替它隐藏等于替它做主。
 *
 * 为什么用 `hidden` 属性而不是 `display:none` 字符串：属性是浏览器原生语义，无障碍树、
 * 样式表与 `:not([hidden])` 选择器都认它；内联样式则要与调用方自己的样式表抢优先级。
 *
 * 用法：`const hud = createHudPanel({ render }); hud.mount(#hud, ctx);` 之后用
 * `setVisible(false)` 收起来、`destroy()` 在游戏页销毁时调用（幂等）。
 */

import type { PageContext } from "./registry.js";

/** 常驻 HUD 壳 */
export interface HudPanel {
  /** 挂载到容器（一次性；已挂或已销毁时无效） */
  mount(container: HTMLElement, ctx: PageContext): void;
  /** 显隐切换（**不销毁**，内部状态保持） */
  setVisible(visible: boolean): void;
  /** 销毁（仅在游戏页销毁时调用；幂等，之后任何调用都不抛） */
  destroy(): void;
}

/**
 * HUD 壳的装配项。
 *
 * @param zone 活区标记名，缺省 `hud`；同一页面上有多个活区时用它在样式与输入作用域里区分
 * @param render 内容填充回调，`mount` 时以根节点为参数调用一次；不传则只有一个空壳根节点
 */
export interface HudPanelOptions {
  zone?: string;
  render?: (root: HTMLElement) => void;
}

/** 默认活区标记名 */
const DEFAULT_ZONE = "hud";

/** 滚动隔离标记：没有它的界面，滚轮会连带触发故事回溯（回溯滚轮见渲染交互契约） */
const UI_ZONE_ATTRIBUTE = "data-ui-zone";

/** 根节点的类名：调用方与样式表据此定位 HUD */
const ROOT_CLASS_NAME = "hud-panel";

/** 造一个常驻 HUD 壳 */
export function createHudPanel(options: HudPanelOptions = {}): HudPanel {
  const zone = options.zone ?? DEFAULT_ZONE;
  const render = options.render;

  let container: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let visible = true;
  let destroyed = false;

  /** 把当前可见性写到根节点上；无变化时不写，避免无意义重排 */
  const applyVisibility = (): void => {
    if (!root) return;
    if (visible) {
      if (root.hasAttribute("hidden")) root.removeAttribute("hidden");
    } else if (!root.hasAttribute("hidden")) {
      root.setAttribute("hidden", "");
    }
  };

  return {
    mount(target: HTMLElement, _ctx: PageContext): void {
      if (destroyed || root !== null) return;
      const element = document.createElement("section");
      element.className = ROOT_CLASS_NAME;
      element.setAttribute(UI_ZONE_ATTRIBUTE, zone);
      target.setAttribute(UI_ZONE_ATTRIBUTE, zone);
      target.appendChild(element);
      container = target;
      root = element;
      if (render) render(element);
      applyVisibility();
    },

    setVisible(next: boolean): void {
      visible = next;
      // 销毁后再调不抛：可见性记下来即可，没有节点可写
      if (destroyed) return;
      applyVisibility();
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (root !== null && container !== null) {
        container.removeChild(root);
        container.removeAttribute(UI_ZONE_ATTRIBUTE);
      }
      root = null;
      container = null;
    },
  };
}

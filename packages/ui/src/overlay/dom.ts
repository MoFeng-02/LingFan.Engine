/**
 * 建层用的最小 DOM 助手：只做「建一个铺满父容器的层」与「让控件恢复点击」两件事。
 *
 * 之所以要有这两个助手，是因为覆盖层的每一层都遵循同一条事件策略：
 * **层自身恒不吃事件**（`pointer-events: none`），层里的实际控件再逐个恢复点击。
 */

/**
 * 建一个铺满父容器的层。
 *
 * 事件策略（嵌入场景的关键）：**层自身恒不吃事件**（`pointer-events: none`），
 * 于是层内空白区透传给宿主游戏——对话框铺满视口时，玩家仍能点击对话框之外的地方。
 * 层里的实际控件（按钮/输入框/元素节点）由渲染处单独恢复点击。
 */
export function el(parent: HTMLElement, className: string, z: number): HTMLElement {
  const node = parent.ownerDocument.createElement("div");
  node.className = className;
  node.style.position = "absolute";
  node.style.inset = "0";
  node.style.zIndex = String(z);
  node.style.pointerEvents = "none";
  parent.appendChild(node);
  return node;
}

/** 让指定控件恢复点击（层自身透明，故必须逐控件开启） */
export function clickable<T extends HTMLElement>(node: T): T {
  node.style.pointerEvents = "auto";
  return node;
}

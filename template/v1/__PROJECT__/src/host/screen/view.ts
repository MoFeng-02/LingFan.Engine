/**
 * 原生形态的启动界面：纯 DOM 造的整屏界面。
 *
 * 骨架宿主不带任何 UI 框架（这正是「框架无关」的活证明），所以启动界面在这里
 * 只能用 `createElement`。**这里只画界面，不做判断**：该不该显示、什么时候显示，
 * 由 `switch.ts` 按屏幕态决定；标题、槽名、可继续与否全部来自入参，本文件不读清单、
 * 不读存档、不认任何列名——一处硬编码就会让模板换个工程就显示错名字。
 */
import type { ScreenView } from "@lingfan-engine/ui";

/** 与样式表共用的类名前缀（`.screen-start*` 系列在 `styles/stage.css`） */
const START_CLASS = "screen-start";

/**
 * 造启动界面的内容。
 *
 * @param view 当前屏幕态（标题、可继续的槽、两个动作）。
 * @returns 已接好按钮的根节点；`view.resume.slot` 为空时「继续」是禁用态。
 *
 * 入参变了请重新造一份再替换——本函数不做差量更新：启动界面每屏最多出现一次，
 * 差量那点收益换不来「哪一半旧哪一半新」的排查成本。
 */
export function createStartScreenElement(view: ScreenView): HTMLElement {
  const root = document.createElement("div");
  root.className = `${START_CLASS}__body`;

  const heading = document.createElement("h1");
  heading.className = `${START_CLASS}__heading`;
  heading.textContent = view.title;
  root.appendChild(heading);

  const subtitle = document.createElement("p");
  subtitle.className = `${START_CLASS}__subtitle`;
  subtitle.textContent = "点开始进入故事；有存档时可从中断处继续。";
  root.appendChild(subtitle);

  const actions = document.createElement("div");
  actions.className = `${START_CLASS}__actions`;

  const resumeSlot = view.resume.slot;
  const cont = document.createElement("button");
  cont.type = "button";
  cont.className = `${START_CLASS}__button`;
  cont.textContent = "继续";
  if (resumeSlot === undefined) {
    cont.disabled = true;
    // 禁用态的原因写在 title 上：按钮点不动时玩家能自己问出为什么
    cont.title = view.resume.reason;
  } else {
    cont.addEventListener("click", () => {
      view.load(resumeSlot);
    });
  }
  actions.appendChild(cont);

  const begin = document.createElement("button");
  begin.type = "button";
  begin.className = `${START_CLASS}__button`;
  begin.textContent = "开始";
  begin.addEventListener("click", () => {
    view.start();
  });
  actions.appendChild(begin);

  root.appendChild(actions);
  return root;
}

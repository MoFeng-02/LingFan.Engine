/**
 * 标题界面（宿主侧示范页面）：用整屏页面渲染 `ui` 列，而不是用 op 一层层画。
 *
 * 这是「页面」这一类的最小可用形态，也是把两条边界演示清楚的地方：
 *
 * 1. **只读经 `StateReader`、只写经命令面**。页面想显示什么就读什么（这里读当前列 id
 *    当作「上次停在哪」的提示），想改变什么就调 `ctx.engine` 上的命令（`navigate` /
 *    `load`）。它不碰状态键，也不自己造存档格式——绕过去就等于绕过了保留键守卫与
 *    快照一致性。
 * 2. **离开即真销毁**。`unmount` 摘掉自己建的节点、解绑自己挂的监听器；不留
 *    「藏起来的旧界面」。切回来时是新实例，所以页面内部不得把跨次状态放在模块级变量里
 *    ——那些状态该进 `gameState`（随存档/回溯随行）。
 *
 * 用法（组合根）：把工厂注册进页面表，再交给 `bootHost` 的 `pages` 与 `pageContainer`：
 *
 * ```ts
 * const pages = createPageRegistry();
 * pages.register("title_main", createTitlePage({ nextColumnId: "chapter1" }));
 * void bootHost({ ..., pages, pageContainer: optional("#page") });
 * ```
 *
 * 页面容器里长什么样、用什么样式，全由本模块与样式表决定——引擎不知道「标题页」是什么，
 * 它只知道自己进了某一列。
 */
import type { Page, PageContext, PageFactory } from "./registry.js";

/** 标题页的可配置文案与跳转目标 */
export interface TitlePageOptions {
  /** 大标题，缺省 `__PROJECT__` */
  title?: string;
  /** 副标题；不给则只显示标题 */
  subtitle?: string;
  /** 「开始游戏」按钮文案 */
  startLabel?: string;
  /** 「继续」按钮文案 */
  continueLabel?: string;
  /**
   * 「开始游戏」要跳到的列 id。
   *
   * 缺省 `chapter1`。跳转是**按列名**的：这个 id 必须是产物里真实存在的列，
   * 页面不需要（也不该）知道它是 JSON 还是 TS 写出来的。
   */
  nextColumnId?: string;
  /** 「继续」读的存档槽位，缺省 `auto`（引擎的自动存档专用槽） */
  autoSlot?: string;
  /** 读不到存档时的提示文案 */
  emptyHint?: string;
}

/** 根节点类名：调用方与样式表据此定位 */
const ROOT_CLASS_NAME = "page-title";

/** 缺省取值：集中在这里，避免散落在装配代码里 */
const DEFAULTS = {
  title: "__PROJECT__",
  startLabel: "开始游戏",
  continueLabel: "继续",
  nextColumnId: "chapter1",
  autoSlot: "auto",
  emptyHint: "",
} as const;

/** 造一个标题页工厂（返回 `PageFactory`，可直接交给 `PageRegistry.register`） */
export function createTitlePage(options: TitlePageOptions = {}): PageFactory {
  const title = options.title ?? DEFAULTS.title;
  const subtitle = options.subtitle;
  const startLabel = options.startLabel ?? DEFAULTS.startLabel;
  const continueLabel = options.continueLabel ?? DEFAULTS.continueLabel;
  const nextColumnId = options.nextColumnId ?? DEFAULTS.nextColumnId;
  const autoSlot = options.autoSlot ?? DEFAULTS.autoSlot;
  const emptyHint = options.emptyHint ?? DEFAULTS.emptyHint;

  // 工厂拿到的 `ctx` 与 `mount` 收到的 `pageContext` 是同一份；这里只认后者，
  // 免得两个名字看起来像能不一样。参数保留是为了满足 `PageFactory` 的形状。
  return (_ctx: PageContext): Page => {
    let root: HTMLElement | null = null;
    let container: HTMLElement | null = null;
    let onStart: (() => void) | null = null;
    let onContinue: (() => void) | null = null;
    let startButton: HTMLElement | null = null;
    let continueButton: HTMLElement | null = null;

    /** 造一个按钮：文案 + 类名 + 点击处理 */
    const makeButton = (
      label: string,
      className: string,
      onClick: () => void,
    ): HTMLElement => {
      const button = document.createElement("button");
      button.className = className;
      button.textContent = label;
      button.addEventListener("click", onClick);
      return button;
    };

    return {
      mount(target: HTMLElement, pageContext: PageContext): void {
        if (root !== null) return;
        const element = document.createElement("section");
        element.className = ROOT_CLASS_NAME;

        const heading = document.createElement("h1");
        heading.className = `${ROOT_CLASS_NAME}__heading`;
        heading.textContent = title;
        element.appendChild(heading);

        if (subtitle !== undefined) {
          const lead = document.createElement("p");
          lead.className = `${ROOT_CLASS_NAME}__subtitle`;
          lead.textContent = subtitle;
          element.appendChild(lead);
        }

        // 读状态：`currentColumnId()` 是「引擎此刻在哪一列」。进到标题页时它就是本页的
        // 列 id，所以这里换成一句人话，演示「页面能读引擎状态」而不必知道状态键的名字。
        const progress = document.createElement("p");
        progress.className = `${ROOT_CLASS_NAME}__progress`;
        const at = pageContext.reader.currentColumnId();
        progress.textContent = at === "" ? emptyHint : `当前界面：${at}`;
        element.appendChild(progress);

        const actions = document.createElement("div");
        actions.className = `${ROOT_CLASS_NAME}__actions`;

        const handleStart = (): void => {
          // 跳转是命令，不是状态写入：页面拿不到「当前列」那个保留键
          pageContext.engine.navigate(nextColumnId);
        };
        const handleContinue = (): void => {
          // 无档时引擎只出 `engine.error` 事件、不抛，界面因此不需要预检存档是否存在
          pageContext.engine.load(autoSlot);
        };

        startButton = makeButton(
          startLabel,
          `${ROOT_CLASS_NAME}__start`,
          handleStart,
        );
        continueButton = makeButton(
          continueLabel,
          `${ROOT_CLASS_NAME}__continue`,
          handleContinue,
        );
        onStart = handleStart;
        onContinue = handleContinue;
        actions.appendChild(startButton);
        actions.appendChild(continueButton);
        element.appendChild(actions);

        target.appendChild(element);
        container = target;
        root = element;
      },

      unmount(): void {
        // 先解绑再摘节点：节点一旦离开文档就再也不会派发事件，但监听器持有闭包，
        // 不解绑等于把整个页面（含 ctx）挂在按钮上，直到 GC 找到循环。
        if (startButton !== null && onStart !== null) {
          startButton.removeEventListener("click", onStart);
        }
        if (continueButton !== null && onContinue !== null) {
          continueButton.removeEventListener("click", onContinue);
        }
        onStart = null;
        onContinue = null;
        startButton = null;
        continueButton = null;
        if (container !== null) container.replaceChildren();
        container = null;
        root = null;
      },
    };
  };
}

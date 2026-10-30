/**
 * 屏幕切换：把当前列与存档摘要折成「此刻该画哪一屏」，并决定谁来落 DOM。
 *
 * 引擎不认识「启动界面」这个概念——它只知道自己停在哪一列、那一列是什么类型。
 * 「现在该画哪一屏」完全由宿主判断，判据是 `ScreenView.screen`：列 id 还是空串
 * （尚未进列）或列类型不是 `game`，都算启动界面。
 *
 * 本文件收三件事，因为它们是同一次切屏的三个面：订阅（哪些变化会影响这一屏）、
 * 折膜（列与存档 → 渲染输入）、落法（谁把这一屏画出来）。落法有两种：
 *
 * - **原生形态**：给 `dom`，本文件造节点、挂到舞台根下、切走时摘掉；
 * - **框架形态**：给 `onView`，本文件只把渲染输入推出去，挂载点的父子关系归框架。
 *   两者互斥，`onView` 优先——往框架管的容器里写子节点会与它的渲染树打架。
 *
 * 为什么原生形态不把舞台摘下来：舞台节点在装配期就被 `must()` 抓住，摘掉再挂回来
 * 等于换了一批新节点，宿主手上的句柄全部失效。启动界面是一层不透明覆盖物，
 * 舞台留在原地、只是不参与交互也不再进无障碍树。
 */
import {
  SYS,
  createStateReader,
  resolveProjectName,
  resolveSavesConfig,
  slotIds,
  type SavePort,
  type SlotSummary,
  type StoryEngine,
} from "@lingfan-engine/core";
import {
  firstGameColumn,
  sameScreenView,
  screenViewOf,
  type ScreenView,
} from "@lingfan-engine/ui";
import type { StageDom } from "./stage-dom";
import { createStartScreenElement } from "./screen/view";

/** 启动界面层的类名（样式在 `styles/stage.css` 的 `.screen-start` 段） */
const START_LAYER_CLASS = "screen-start";

/** 切屏所需的宿主上下文 */
export interface ScreenSwitchOptions {
  /** 引擎：订阅当前列、导航与读档的落地 */
  engine: StoryEngine;
  /** 工程清单：展示名与存档槽位都从这里读，宿主不自带字面量 */
  manifest: unknown;
  /** 入口列 id（来自故事本身，不是宿主写死的名字） */
  entry: string;
  /** 存档端口：「继续」要挑最近写入的槽，只能问它 */
  savePort: SavePort;
  /** 诊断出口（错误条 + 控制台） */
  reportError(message: string): void;
  /** 常驻节点句柄表（原生形态用它造节点、静默舞台） */
  dom?: StageDom;
  /**
   * 自己接管落法（框架形态）：给了就只把渲染输入推出去，本文件不碰 DOM。
   *
   * 与 `dom` 互斥，本项优先。框架形态拿它喂各自的订阅盒，
   * 屏幕的显隐与无障碍属性由模板绑定——本文件不写框架管的节点。
   */
  onView?: (view: ScreenView) => void;
}

/** 屏幕切换器：重算并落 DOM、拆除 */
export interface ScreenSwitch {
  /** 重新算一次并推送/落 DOM（存档摘要回流后也要调它） */
  refresh(): void;
  /** 退订并摘掉已挂的界面（可重复调用） */
  dispose(): void;
}

/**
 * 舞台让位时要静默的层。
 *
 * 只静默这些具体层而不动根节点：启动界面自身挂在根节点下，把根节点整棵置为
 * `inert` 会连启动界面的按钮一起禁掉。`#transition` 与 `#error` 不在表里——前者是
 * 转场遮罩（恒在最上层，不需要静默），后者是诊断出口（出错时必须还能看见）。
 */
function stageLayers(dom: StageDom): readonly HTMLElement[] {
  return [
    dom.stage,
    dom.nvl,
    dom.dialogue,
    dom.choices,
    dom.notifications,
    dom.toolbar,
  ];
}

/**
 * 装配屏幕切换。
 *
 * @param options 引擎、清单、入口列、存档端口、诊断出口，以及落法（`dom` 或 `onView`）。
 * @returns 切换器（见 {@link ScreenSwitch}）。
 *
 * 一装配就先算一次并落 DOM：`engine.start()` 之前当前列 id 是空串，此刻必须
 * 画启动界面，等到第一次状态变化才画就会先闪一帧舞台。
 */
export function createScreenSwitch(options: ScreenSwitchOptions): ScreenSwitch {
  const { engine, manifest, entry, savePort, reportError, onView } = options;
  const dom = onView === undefined ? options.dom : undefined;
  if (onView === undefined && dom === undefined) {
    throw new Error(
      "屏幕切换缺少落法：要么给 dom（原生），要么给 onView（框架）",
    );
  }
  const reader = createStateReader(engine);
  const title = resolveProjectName(manifest);
  const slots = slotIds(resolveSavesConfig(manifest).slots);
  const layers = dom === undefined ? [] : stageLayers(dom);

  let saves: readonly SlotSummary[] = [];
  let current: ScreenView | undefined = undefined;
  let mounted: HTMLElement | null = null;
  let disposed = false;
  /** 存档摘要读失败后不再重试：同一次装配里失败原因不会自己变好 */
  let savesFailed = false;

  /**
   * 进入游戏：把「开始」翻译成一个具体列 id。
   *
   * 找不到可进入的 `game` 列时只报一行诊断，不导航——导航到空列会让玩家进一片
   * 空白，比按钮点了没反应更难查。
   */
  const start = (): void => {
    const target = firstGameColumn(engine.columns(), entry);
    if (target === undefined) {
      reportError("故事里没有任何游戏列，「开始」无处可去");
      return;
    }
    engine.navigate(target);
  };

  /** 读档：`load` 返回的是「已受理」，真正的失败走引擎错误通道 */
  const load = (slot: string): void => {
    engine.load(slot);
  };

  const viewOf = (): ScreenView =>
    screenViewOf({
      columnId: reader.currentColumnId(),
      columnType: reader.currentColumnType(),
      title,
      slots,
      saves,
      start,
      load,
    });

  /**
   * 舞台是否让位（仅原生形态）。
   *
   * `inert` 让子树不可聚焦、不响应指针，`aria-hidden` 让读屏跳过它——只写其中一个
   * 都会留下「摸得到但点不动」或「看不见却被读出来」的半拉状态。
   */
  const setStageIdle = (idle: boolean): void => {
    for (const layer of layers) {
      if (idle) {
        layer.setAttribute("inert", "");
        layer.setAttribute("aria-hidden", "true");
        continue;
      }
      layer.removeAttribute("inert");
      layer.removeAttribute("aria-hidden");
    }
  };

  /** 造一层包住启动界面的容器：类名给样式，点击不外传给舞台的推进监听 */
  const createLayer = (view: ScreenView): HTMLElement => {
    const layer = document.createElement("div");
    layer.className = START_LAYER_CLASS;
    layer.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    layer.appendChild(createStartScreenElement(view));
    return layer;
  };

  /** 原生形态的落 DOM：启动界面在场就换一份新的，不在场就摘掉 */
  const renderNative = (view: ScreenView): void => {
    if (dom === undefined) return;
    if (view.screen !== "start") {
      if (mounted === null) return;
      mounted.remove();
      mounted = null;
      setStageIdle(false);
      return;
    }
    // 每次都是新节点：上一屏可能把焦点与旧绑定的闭包留在原地，原地换文案会留下它们
    const next = createLayer(view);
    if (mounted === null) dom.root.appendChild(next);
    else mounted.replaceWith(next);
    mounted = next;
    setStageIdle(true);
  };

  const refresh = (): void => {
    if (disposed) return;
    const next = viewOf();
    if (current !== undefined && sameScreenView(current, next)) return;
    current = next;
    if (onView !== undefined) onView(next);
    else renderNative(next);
  };

  /** 存档摘要回流：写档与读档都会改变「哪一槽是继续」，值得再问一次端口 */
  const reloadSaves = (): void => {
    if (disposed || savesFailed) return;
    void savePort
      .list()
      .then((list) => {
        saves = list;
        refresh();
      })
      .catch((error: unknown) => {
        savesFailed = true;
        reportError(`读存档列表失败：${String(error)}`);
      });
  };

  const offState = engine.onStateChanged(({ key }) => {
    if (key !== SYS.currentSceneColumn) return;
    refresh();
  });
  const offEvent = engine.onEvent((event) => {
    const kind = event.payload.kind;
    if (kind !== "save.done" && kind !== "load.done") return;
    reloadSaves();
  });

  reloadSaves();
  refresh();

  return {
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      offState();
      offEvent();
      if (mounted === null) return;
      mounted.remove();
      mounted = null;
      setStageIdle(false);
    },
  };
}

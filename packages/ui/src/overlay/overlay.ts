/**
 * 叙事覆盖层装配器：把一个父容器变成可运行的叙事覆盖层。
 *
 * **解决的问题**：把叙事能力嵌入已有游戏（2D/3D 引擎）时，宿主原本要照抄一份
 * 参考宿主的渲染接线（五个挂载点 + 状态投影 + 打字机 + 帧循环 + 输入判据）。
 * 本装配器把这套接线收进展示层：宿主只给一个容器与一个引擎实例。
 *
 * **设计约束（与引擎架构一致）**：
 * - 引擎核心**不驱动帧**（rAF 归宿主），本装配器就是那个宿主：它持帧循环，
 *   只做插值，不逐帧写状态（帧级高频键由引擎的静默写通道负责）。
 * - 挂载点与层级 z 由本装配器创建（`RenderTargets` 的宿主侧落地）；引擎只写状态。
 * - 模板注册表可选注入，不传即内建默认（fail-soft：模板只决定「长什么样」）。
 * - **不自行绑定键盘**：宿主游戏的键位归宿主。本层只提供判据与命令入口，
 *   并复用展示层唯一的输入判据（`isGameInputTarget`），不另立第二份口径。
 *
 * **不做什么**：不创建引擎、不装配平台端口（存档/资源/音频是平台能力，由宿主
 * 经 `EngineOptions` 注入）、不改叙事语义。
 */
import type {
  ElementInstance,
  LayerId,
  LayerZTable,
  StoryEngine,
} from "@lingfan/engine";
import {
  DEFAULT_LAYER_Z,
  INSTANCE_Z_KEYS,
  SYS,
  instanceZLayer,
  resolveInstanceZ,
} from "@lingfan/engine";
import { isGameInputTarget } from "../input/scope";
import { Typewriter } from "../dialogue/typewriter";
import { renderDialogueLine } from "../dialogue/textView";
import {
  builtinBubbleTemplate,
  type DialogueTemplateRegistry,
} from "../dialogue/templates";
import {
  builtinChoiceTemplate,
  type ChoiceTemplateRegistry,
} from "../choices/templates";
import {
  builtinNotifyTemplate,
  toNotifyTone,
  type NotifyTemplateRegistry,
} from "../notify/templates";
import { createElementRegistry, type ElementRegistry } from "../element/registry";
import { registerBuiltinElementRenderers } from "../element/renderers";
import { renderElementTree } from "../element/render";
import { resolveElementAction } from "../element/interaction";

/** 内建元素渲染器注册表（36 类型全集） */
function createBuiltinElementRegistry(): ElementRegistry {
  const registry = createElementRegistry();
  registerBuiltinElementRenderers(registry);
  return registry;
}

/** 覆盖层挂载点（`RenderTargets` 的宿主侧落地形态） */
export interface NarrativeMounts {
  /** 覆盖层根 */
  root: HTMLElement;
  /** 舞台层：背景 / 立绘 */
  stage: HTMLElement;
  /** 元素层：舞台之上的空间层（元素树渲染目标） */
  elementLayer: HTMLElement;
  /** 对话层（含打字机） */
  dialogue: HTMLElement;
  /** 选择层（菜单 / 输入） */
  choices: HTMLElement;
  /** 通知层（toast） */
  overlay: HTMLElement;
  /** 外部系统接管层（小游戏 / 玩法系统） */
  takeover: HTMLElement;
  /** 全屏转场遮罩 */
  transition: HTMLElement;
}

/** 渲染投影（只读快照；宿主诊断与自定义渲染可读） */
export interface NarrativeOverlayView {
  speaker: string;
  text: string;
  /** 当前正文 HTML（打字中 = 可见前缀） */
  lineHtml: string;
  canAdvance: boolean;
  /** 当前等待态（`none` = 无等待） */
  waiting: string;
  menuPrompt: string;
  /** 选项（文本 + 目标列，顺序即呈现顺序） */
  menuOptions: readonly { text: string; target: string }[];
  inputPrompt: string;
  nvlMode: string;
  nvlLines: readonly string[];
  /** 元素树是否非空（宿主可据此决定是否显示自己的背景层） */
  hasElements: boolean;
}

export interface NarrativeOverlayOptions {
  /** 挂载点父容器（本装配器在其内创建层骨架） */
  container: HTMLElement;
  /** 引擎实例（已构造；`start()` 与平台端口归宿主） */
  engine: StoryEngine;
  /**
   * 每帧回调（宿主游戏主循环钩子）：本装配器每帧调用一次，
   * 宿主据此把覆盖层与自己引擎的位置对齐（如气泡跟随角色）。
   */
  onFrame?: (dtSeconds: number) => void;
  /** 打字速度（字符/秒；缺省 30，与内建默认一致） */
  textSpeed?: number;
  /** 渲染投影变化通知（宿主可作状态指示；每帧打字推进也会触发） */
  onView?: (view: NarrativeOverlayView) => void;
  /** 对话模板注册表（不传 = 内建） */
  dialogueTemplates?: DialogueTemplateRegistry;
  /** 选择模板注册表（不传 = 内建） */
  choiceTemplates?: ChoiceTemplateRegistry;
  /** 通知模板注册表（不传 = 内建） */
  notifyTemplates?: NotifyTemplateRegistry;
  /** 元素渲染器注册表（不传 = 内建全集） */
  elementRegistry?: ElementRegistry;
  /**
   * 层级 z 表（不传 = 内建默认）。
   * 宿主若从 `project.json shell.layers` 解析过覆盖表，经 `resolveLayerZ` 后注入。
   */
  layerZ?: LayerZTable;
  /** 元素 `cmd` 命令处理器（未注册 fail-closed 上报） */
  commands?: Map<
    string,
    (value: string | undefined, element: ElementInstance) => void
  >;
  /** 资源解析（元素 source/src/path → URL） */
  resolveResource?: (path: string) => string | undefined;
  /** 错误上报（引擎错误、未注册类型/命令；缺省 = 控制台） */
  onError?: (message: string) => void;
}

/** 通知缺省停留时长（`notify` op 的 `duration` 优先） */
const NOTIFY_DURATION_MS = 3000;

export interface NarrativeOverlay {
  /** 挂载点（宿主可进一步定制，如往 stage 内插自己的背景） */
  readonly mounts: NarrativeMounts;
  /** 当前渲染投影（只读） */
  view(): NarrativeOverlayView;
  /** 与引擎状态对齐（读档 / 回溯完成后调用） */
  sync(): void;
  /** 帧循环开关（宿主游戏暂停时可关，避免空转） */
  setRunning(running: boolean): void;
  /**
   * 输入是否归叙事层消费（**只判事件目标**：控件/面板内不吃）。
   * 模式层面的让位（外部玩法系统接管）由宿主按自己的域状态决定——
   * 那是宿主游戏的路由权，覆盖层不替它拍板。
   */
  shouldConsumeInput(event: Event): boolean;
  /** 推进（二段式已处理：打字中先瞬间完成） */
  advance(): void;
  /** 选择选项（`menu` 等待） */
  choose(target: string): void;
  /** 提交输入（`input` 等待） */
  submitInput(value: string): void;
  /** 卸载：停帧循环、退订、清空挂载点 */
  dispose(): void;
}

/**
 * 建一个铺满父容器的层。
 *
 * 事件策略（嵌入场景的关键）：**层自身恒不吃事件**（`pointer-events: none`），
 * 于是层内空白区透传给宿主游戏——对话框铺满视口时，玩家仍能点击对话框之外的地方。
 * 层里的实际控件（按钮/输入框/元素节点）由渲染处单独恢复点击。
 */
function el(parent: HTMLElement, className: string, z: number): HTMLElement {
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
function clickable<T extends HTMLElement>(node: T): T {
  node.style.pointerEvents = "auto";
  return node;
}

/**
 * 装配叙事覆盖层。
 *
 * ```ts
 * const overlay = createNarrativeOverlay({ container, engine });
 * engine.start();
 * window.addEventListener("keydown", (e) => {
 *   if (e.key === " " && overlay.shouldConsumeInput(e)) overlay.advance();
 * });
 * // 卸载：overlay.dispose();
 * ```
 */
export function createNarrativeOverlay(
  options: NarrativeOverlayOptions,
): NarrativeOverlay {
  const { container, engine } = options;
  const report = options.onError ?? ((m: string) => console.error(m));
  const layerZ: LayerZTable = options.layerZ ?? DEFAULT_LAYER_Z;

  const root = el(container, "lf-overlay", 0);
  const stage = el(root, "lf-stage", resolveInstanceZ("stage", undefined, layerZ));
  const elementLayer = el(stage, "lf-element-layer", 0);
  const transition = el(
    root,
    "lf-transition",
    resolveInstanceZ("video", undefined, layerZ),
  );
  const dialogue = el(
    root,
    "lf-dialogue",
    resolveInstanceZ("dialogue", undefined, layerZ),
  );
  const choices = el(
    root,
    "lf-choices",
    resolveInstanceZ("choices", undefined, layerZ),
  );
  const takeover = el(
    root,
    "lf-takeover",
    resolveInstanceZ("minigame", undefined, layerZ),
  );
  const overlay = el(
    root,
    "lf-notifications",
    resolveInstanceZ("notifications", undefined, layerZ),
  );
  // 接管层空闲时不占位（外部系统挂载时才显示）
  takeover.style.display = "none";
  choices.style.display = "none";

  const mounts: NarrativeMounts = {
    root,
    stage,
    elementLayer,
    dialogue,
    choices,
    overlay,
    takeover,
    transition,
  };

  const elements =
    options.elementRegistry ?? createBuiltinElementRegistry();
  const textSpeed = options.textSpeed ?? 30;

  // —— 渲染状态（仅经 ValueChanged 更新；本层不持有叙事真相）——
  let speaker = "";
  /**
   * 说话人颜色 = **命令覆盖色 > 角色定义色 > 空**。
   * 抽成函数而非在两个键的分支里各算一次：引擎写 `color` 与 `speaker` 是两个独立条目，
   * 若只在 `speaker` 分支计算，覆盖色可能尚未到达 ⇒ 颜色滞后一句。
   * 派生函数幂等，两个键变更都调它。
   */
  let speakerColor = "";
  let text = "";
  let canAdvance = false;
  let waiting = "none";
  let menuPrompt = "";
  /** 选项文本与目标列成对（顺序即呈现顺序；点击交核心 `choose(target)`） */
  let menuOptions: Array<{ text: string; target: string }> = [];
  let inputPrompt = "";
  let nvlMode = "none";
  let nvlBuffer: string[] = [];
  let elementList: ElementInstance[] = [];
  let dialogHidden = false;
  let zOverride: Partial<Record<LayerId, number>> = {};
  let typewriter: Typewriter | null = null;
  let shownText = "";
  let rafId = 0;
  let lastFrame = 0;
  let running = true;
  let disposed = false;
  const notifyTimers = new Set<ReturnType<typeof setTimeout>>();

  function applyZ(): void {
    dialogue.style.zIndex = String(
      resolveInstanceZ("dialogue", zOverride.dialogue, layerZ),
    );
    choices.style.zIndex = String(
      resolveInstanceZ("choices", zOverride.choices, layerZ),
    );
    overlay.style.zIndex = String(
      resolveInstanceZ("notifications", zOverride.notifications, layerZ),
    );
    takeover.style.zIndex = String(
      resolveInstanceZ("minigame", zOverride.minigame, layerZ),
    );
    transition.style.zIndex = String(
      resolveInstanceZ("video", zOverride.video, layerZ),
    );
  }

  /**
   * 读菜单选项：文本与目标列成对。
   * 两个键分属不同 SSOT 条目，任一到达都重读**成对数据**（避免只更新一半）。
   */
  function readMenuOptions(): void {
    const texts = engine.get(SYS.menuOptions);
    const targets = engine.get(SYS.menuTargets);
    const textList = Array.isArray(texts) ? texts.map(String) : [];
    const targetList = Array.isArray(targets) ? targets.map(String) : [];
    menuOptions = textList.map((text, i) => ({
      text,
      target: targetList[i] ?? "",
    }));
  }

  /** 说话人颜色派生（幂等）：命令覆盖色 > 角色定义色 > 空串 */
  function refreshSpeakerColor(): void {
    const override = engine.get(SYS.currentDialogColor);
    const def = engine.getCharacter(speaker);
    speakerColor =
      (typeof override === "string" && override !== "" ? override : def?.color) ??
      "";
  }

  function evalDisable(expression: string): boolean | null {
    const out = engine.interpolate(expression);
    if (out === "true") return true;
    if (out === "false") return false;
    return null;
  }

  function activateElement(element: ElementInstance): void {
    const action = resolveElementAction(element.props, { evalDisable });
    if (action.kind === "nav") {
      engine.navigate(action.target);
      return;
    }
    if (action.kind === "ops") {
      if (!engine.runElementOps(action.ops)) {
        report("元素动作执行失败（等待/位置类 op 与畸形负载会被拒绝）");
      }
      return;
    }
    if (action.kind !== "cmd") return;
    const handler = options.commands?.get(action.name);
    if (handler === undefined) {
      report(`元素命令未注册：${action.name}（fail-closed：需宿主经命令注册表提供）`);
      return;
    }
    handler(
      action.value === undefined ? undefined : engine.interpolate(action.value),
      element,
    );
  }

  function renderElements(): void {
    // 交互元素的 pointer-events 由渲染器自行恢复（`bindInteraction` 给有交互动词的
    // 节点置 cursor:pointer + pointer-events:auto）——本层不重判第二遍。
    renderElementTree({
      registry: elements,
      container: elementLayer,
      elements: elementList,
      activate: activateElement,
      evalDisable,
      resolveResource: options.resolveResource,
      onUnknownType: (type) =>
        report(`元素类型未注册：${type}（fail-closed：不伪造渲染）`),
    });
  }

  function lineHtml(): string {
    return renderDialogueLine({
      text,
      typed: typewriter !== null && !typewriter.done ? shownText : undefined,
    }).html;
  }

  function renderDialogue(): void {
    const template =
      options.dialogueTemplates?.resolve(
        typeof engine.get(SYS.dialogTemplate) === "string"
          ? (engine.get(SYS.dialogTemplate) as string)
          : null,
      ) ?? builtinBubbleTemplate;
    const built = template({
      speaker,
      speakerColor,
      lineHtml: lineHtml(),
      canAdvance,
    });
    const doc = container.ownerDocument;
    dialogue.className = `lf-dialogue ${built.rootClass}`;
    dialogue.innerHTML = "";
    if (built.speakerHtml !== "") {
      const p = doc.createElement("p");
      p.className = "lf-speaker";
      p.innerHTML = built.speakerHtml;
      if (speakerColor !== "") p.style.color = speakerColor;
      dialogue.appendChild(p);
    }
    const body = doc.createElement("p");
    body.className = "lf-text";
    body.innerHTML = built.bodyHtml;
    dialogue.appendChild(body);
    if (built.hintHtml !== "") {
      const hint = doc.createElement("span");
      hint.className = "lf-hint";
      hint.innerHTML = built.hintHtml;
      dialogue.appendChild(hint);
    }
    const visible =
      !dialogHidden && waiting !== "menu" && waiting !== "input" && waiting !== "video";
    dialogue.style.display = visible ? "" : "none";
  }

  function renderChoices(): void {
    const doc = container.ownerDocument;
    const active = waiting === "menu" || waiting === "input";
    choices.style.display = active ? "" : "none";
    choices.innerHTML = "";
    if (!active) return;

    if (waiting === "input") {
      choices.className = "lf-choices";
      const label = doc.createElement("p");
      label.className = "lf-prompt";
      label.textContent = inputPrompt;
      const form = doc.createElement("form");
      form.className = "lf-input-row";
      const input = clickable(doc.createElement("input"));
      input.type = "text";
      input.setAttribute("aria-label", inputPrompt === "" ? "输入" : inputPrompt);
      const submit = clickable(doc.createElement("button"));
      submit.type = "submit";
      submit.textContent = "确定";
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        submitInput(input.value.trim());
      });
      form.append(input, submit);
      choices.append(label, form);
      return;
    }

    const built = (options.choiceTemplates?.resolve(null) ?? builtinChoiceTemplate)(
      { prompt: menuPrompt, options: menuOptions },
    );
    choices.className = `lf-choices ${built.rootClass}`;
    if (built.promptHtml !== "") {
      const p = doc.createElement("p");
      p.className = "lf-prompt";
      p.innerHTML = built.promptHtml;
      choices.appendChild(p);
    }
    const row = doc.createElement("div");
    row.className = "lf-choice-row";
    for (const [idx, option] of menuOptions.entries()) {
      const btn = clickable(doc.createElement("button"));
      btn.type = "button";
      btn.innerHTML = built.optionHtml[idx] ?? "";
      // innerHTML 内容不进无障碍名计算（等价于 v-html）：显式给可访问名
      btn.setAttribute("aria-label", option.text);
      // 点击交核心 choose(目标是列 id，不是显示文本)
      btn.addEventListener("click", () => choose(option.target));
      row.appendChild(btn);
    }
    choices.appendChild(row);
  }

  function renderNotify(payload: {
    text: string;
    notifyType?: string;
    duration?: number;
  }): void {
    const built = (options.notifyTemplates?.resolve(null) ?? builtinNotifyTemplate)(
      { text: payload.text, tone: toNotifyTone(payload.notifyType) },
    );
    const item = container.ownerDocument.createElement("div");
    item.className = built.rootClass;
    item.innerHTML = built.bodyHtml;
    overlay.appendChild(item);
    const timer = setTimeout(() => {
      notifyTimers.delete(timer);
      item.remove();
    }, payload.duration ?? NOTIFY_DURATION_MS);
    notifyTimers.add(timer);
  }

  function view(): NarrativeOverlayView {
    return {
      speaker,
      text,
      lineHtml: lineHtml(),
      canAdvance,
      waiting,
      menuPrompt,
      menuOptions,
      inputPrompt,
      nvlMode,
      nvlLines: nvlBuffer,
      hasElements: elementList.length > 0,
    };
  }

  const offState = engine.onStateChanged(({ key, value }) => {
    const zLayer = instanceZLayer(key);
    if (zLayer !== undefined) {
      zOverride = {
        ...zOverride,
        [zLayer]: typeof value === "number" ? value : undefined,
      };
      applyZ();
      return;
    }
    if (key === SYS.currentDialogSpeaker) {
      speaker = typeof value === "string" ? value : "";
      refreshSpeakerColor();
      renderDialogue();
    } else if (key === SYS.currentDialogColor) {
      // 覆盖色与说话人色同源刷新（派生值不依赖事件到达顺序，重算幂等）
      refreshSpeakerColor();
      renderDialogue();
    } else if (key === SYS.currentDialogText) {
      text = typeof value === "string" ? value : "";
      typewriter = new Typewriter(text, textSpeed);
      shownText = typewriter.visible;
      renderDialogue();
    } else if (key === SYS.waiting) {
      waiting = typeof value === "string" ? value : "none";
      canAdvance = waiting === "dialog";
      renderDialogue();
      renderChoices();
    } else if (key === SYS.dialogVisible) {
      dialogHidden = value === "hide";
      renderDialogue();
    } else if (key === SYS.menuPrompt) {
      menuPrompt = typeof value === "string" ? value : "";
      renderChoices();
    } else if (key === SYS.menuOptions || key === SYS.menuTargets) {
      readMenuOptions();
      renderChoices();
    } else if (key === SYS.inputPrompt) {
      inputPrompt = typeof value === "string" ? value : "";
      renderChoices();
    } else if (key === SYS.nvlMode) {
      nvlMode = typeof value === "string" ? value : "none";
    } else if (key === SYS.nvlBuffer) {
      nvlBuffer = Array.isArray(value) ? value.map(String) : [];
    } else if (key === SYS.elements) {
      elementList = Array.isArray(value) ? (value as ElementInstance[]) : [];
      renderElements();
    }
    options.onView?.(view());
  });

  const offEvent = engine.onEvent(({ payload }) => {
    if (payload.kind === "notify") renderNotify(payload);
    else if (payload.kind === "engine.error") report(payload.message);
  });

  function frame(now: number): void {
    if (disposed) return;
    if (!running) return;
    const dt = lastFrame === 0 ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;
    if (typewriter !== null && !typewriter.done) {
      typewriter.tick(dt);
      const next = typewriter.visible;
      if (next !== shownText) {
        shownText = next;
        // 打字帧只重渲正文（说话人/提示不变 ⇒ 宿主 diff 不 patch）
        renderDialogue();
        options.onView?.(view());
      }
    }
    options.onFrame?.(dt);
    rafId = container.ownerDocument.defaultView?.requestAnimationFrame(frame) ?? 0;
  }

  /** 帧循环的宿主入口：无 rAF 环境（测试/降级）下静默不启，功能仍可用 */
  const view0 = container.ownerDocument.defaultView;
  if (view0 !== null && view0 !== undefined) {
    rafId = view0.requestAnimationFrame(frame);
  }

  function sync(): void {
    const read = (key: string): unknown => engine.get(key);
    const str = (key: string): string => {
      const v = read(key);
      return typeof v === "string" ? v : "";
    };
    speaker = str(SYS.currentDialogSpeaker);
    refreshSpeakerColor();
    text = str(SYS.currentDialogText);
    waiting = str(SYS.waiting) === "" ? "none" : str(SYS.waiting);
    canAdvance = waiting === "dialog";
    menuPrompt = str(SYS.menuPrompt);
    readMenuOptions();
    inputPrompt = str(SYS.inputPrompt);
    nvlMode = str(SYS.nvlMode) === "" ? "none" : str(SYS.nvlMode);
    const nb = read(SYS.nvlBuffer);
    nvlBuffer = Array.isArray(nb) ? nb.map(String) : [];
    dialogHidden = read(SYS.dialogVisible) === "hide";
    const els = read(SYS.elements);
    elementList = Array.isArray(els) ? (els as ElementInstance[]) : [];
    typewriter = new Typewriter(text, textSpeed);
    shownText = typewriter.visible;
    const z: Partial<Record<LayerId, number>> = {};
    for (const [layer, key] of Object.entries(INSTANCE_Z_KEYS)) {
      const v = read(key as string);
      if (typeof v === "number") z[layer as LayerId] = v;
    }
    zOverride = z;
    applyZ();
    renderDialogue();
    renderChoices();
    renderElements();
  }

  function advance(): void {
    if (typewriter !== null && !typewriter.done) {
      typewriter.click();
      shownText = typewriter.visible;
      renderDialogue();
      options.onView?.(view());
      return;
    }
    // 只有「推进类」等待态才交引擎：menu 归 choose、input 归 input、
    // 外部接管归 resolve。否则引擎会回一条无效调用错误——那是误报，不是玩家错。
    if (waiting === "dialog" || waiting === "wait" || waiting === "video") {
      engine.advance();
    }
  }

  function choose(target: string): void {
    engine.choose(target);
  }

  function submitInput(value: string): void {
    engine.input(value);
  }

  function shouldConsumeInput(event: Event): boolean {
    // 复用展示层唯一判据：控件与 UI 面板内的输入不归叙事
    return isGameInputTarget((event as { target?: unknown }).target);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    running = false;
    if (rafId !== 0) view0?.cancelAnimationFrame(rafId);
    offState();
    offEvent();
    for (const timer of notifyTimers) clearTimeout(timer);
    notifyTimers.clear();
    root.remove();
  }

  renderDialogue();
  renderChoices();

  function setRunning(next: boolean): void {
    if (next === running) return;
    running = next;
    lastFrame = 0;
    if (running && !disposed && view0 !== null && view0 !== undefined) {
      rafId = view0.requestAnimationFrame(frame);
    }
  }

  return {
    mounts,
    view,
    sync,
    setRunning,
    shouldConsumeInput,
    advance,
    choose,
    submitInput,
    dispose,
  };
}

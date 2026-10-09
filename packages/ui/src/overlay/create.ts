/**
 * 叙事覆盖层装配器：把一个父容器变成可运行的叙事覆盖层。
 *
 * **解决的问题**：把叙事能力嵌入已有游戏（2D/3D 引擎）时，宿主原本要照抄一份
 * 参考宿主的渲染接线（五个挂载点 + 状态投影 + 打字机 + 帧循环 + 输入判据）。
 * 本装配器把这套接线收进展示层：宿主只给一个容器与一个引擎实例。
 *
 * **设计约束（与引擎架构一致）**：
 * - 引擎核心**不驱动帧**（帧归宿主），本装配器就是那个宿主：它持帧循环，
 *   只做插值，不逐帧写状态（帧级高频键由引擎自己的静默写通道负责）。
 * - 挂载点与层级 z 由本装配器创建（渲染目标的宿主侧落地）；引擎只写状态。
 * - 模板注册表可选注入，不传即内建默认（模板只决定「长什么样」）。
 * - **不自行绑定键盘**：宿主游戏的键位归宿主。本层只提供判据与命令入口，
 *   并复用展示层唯一的输入判据（`isGameInputTarget`），不另立第二份口径。
 *
 * **不做什么**：不创建引擎、不装配平台端口（存档/资源/音频是平台能力，由宿主
 * 经引擎选项注入）、不改叙事语义。
 *
 * 本模块只做**装配、接线与销毁编排**：各职责的实现分别在同目录的
 * `mounts` / `projector` / `*-view` / `element-tree` / `frame-loop` 内。
 * 所有状态都由各职责的工厂持有（每次调用装配器产出独立的一份），
 * 因此两个覆盖层实例互不串扰。
 */
import { createStateReader, DEFAULT_LAYER_Z } from "@lingfan/engine";
import type { LayerZTable } from "@lingfan/engine";
import { isGameInputTarget } from "../input/scope";
import { createElementRegistry } from "../element/registry";
import type { ElementRegistry } from "../element/registry";
import { registerBuiltinElementRenderers } from "../element";
import { createChoicesView } from "./choices-view";
import { createDialogueView } from "./dialogue-view";
import { createElementTree } from "./element-tree";
import { createFrameLoop } from "./frame-loop";
import { createLayerZController } from "./layer-z";
import { createMounts } from "./mounts";
import { createNotifyView } from "./notify-view";
import { createProjector } from "./projector";
import type { RenderTarget } from "./projector";
import type { NarrativeOverlay, NarrativeOverlayOptions } from "./types";

/** 内建元素渲染器注册表（36 类型全集） */
function createBuiltinElementRegistry(): ElementRegistry {
  const registry = createElementRegistry();
  registerBuiltinElementRenderers(registry);
  return registry;
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
  const reader = createStateReader(engine);

  const mounts = createMounts(container, layerZ);
  const elements = options.elementRegistry ?? createBuiltinElementRegistry();
  const textSpeed = options.textSpeed ?? 30;

  const layerZController = createLayerZController(mounts, layerZ);
  const projector = createProjector({
    reader,
    engine,
    layerZ: layerZController,
    textSpeed,
  });

  const renderDialogue = createDialogueView({
    container,
    mounts,
    templates: options.dialogueTemplates,
    readTemplateName: () => reader.dialogTemplate(),
  });
  const renderChoices = createChoicesView({
    container,
    mounts,
    templates: options.choiceTemplates,
    choose: (target) => engine.choose(target),
    submitInput: (value) => engine.input(value),
  });
  const notifyView = createNotifyView({
    container,
    mounts,
    templates: options.notifyTemplates,
  });
  const elementTree = createElementTree({
    registry: elements,
    container: mounts.elementLayer,
    engine,
    commands: options.commands,
    resolveResource: options.resolveResource,
    report,
  });

  /** 重渲对话层（正文 HTML 每次现算：打字帧下它就是变化的那部分） */
  function renderDialogueNow(): void {
    const s = projector.state;
    renderDialogue({
      speaker: s.speaker,
      speakerColor: s.speakerColor,
      canAdvance: s.canAdvance,
      dialogHidden: s.dialogHidden,
      waiting: s.waiting,
      lineHtml: projector.lineHtml(),
    });
  }

  /** 重渲选择层 */
  function renderChoicesNow(): void {
    const s = projector.state;
    renderChoices({
      waiting: s.waiting,
      menuPrompt: s.menuPrompt,
      menuOptions: s.menuOptions,
      inputPrompt: s.inputPrompt,
    });
  }

  /** 重渲元素树 */
  function renderElementsNow(): void {
    elementTree.render(projector.state.elementList);
  }

  /** 按投影给出的目标顺序重渲（顺序即层间重渲顺序） */
  function renderTargets(targets: readonly RenderTarget[]): void {
    for (const target of targets) {
      if (target === "dialogue") renderDialogueNow();
      else if (target === "choices") renderChoicesNow();
      else renderElementsNow();
    }
  }

  /** 打字进度推进后：只重渲正文，再把投影变化通知宿主 */
  function onTyped(): void {
    renderDialogueNow();
    options.onView?.(projector.view());
  }

  const offState = engine.onStateChanged(({ key, value }) => {
    const effect = projector.applyChange(key, value);
    // 层级 z 只改样式，不产生渲染目标，也不通知投影变化（其余键都通知）
    if (effect.kind === "layers") return;
    renderTargets(effect.targets);
    options.onView?.(projector.view());
  });

  const offEvent = engine.onEvent(({ payload }) => {
    if (payload.kind === "notify") notifyView.render(payload);
    else if (payload.kind === "engine.error") report(payload.message);
  });

  // 帧循环的宿主入口：无 rAF 环境（测试/降级）下静默不启，功能仍可用
  const view0 = container.ownerDocument.defaultView;
  const frameLoop = createFrameLoop({
    view: view0,
    readView: () => container.ownerDocument.defaultView,
    tickTypewriter: (dt) => projector.tickTypewriter(dt),
    onTyped,
    onFrame: options.onFrame,
  });
  frameLoop.start();

  function sync(): void {
    renderTargets(projector.sync());
  }

  function advance(): void {
    if (projector.finishTypewriter()) {
      onTyped();
      return;
    }
    // 只有「推进类」等待态才交引擎：menu 归 choose、input 归 input、
    // 外部接管归 resolve。否则引擎会回一条无效调用错误——那是误报，不是玩家错。
    const waiting = projector.state.waiting;
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

  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    frameLoop.stop();
    offState();
    offEvent();
    notifyView.clear();
    mounts.root.remove();
  }

  function setRunning(next: boolean): void {
    frameLoop.setRunning(next);
  }

  renderDialogueNow();
  renderChoicesNow();

  return {
    mounts,
    view: () => projector.view(),
    sync,
    setRunning,
    shouldConsumeInput,
    advance,
    choose,
    submitInput,
    dispose,
  };
}

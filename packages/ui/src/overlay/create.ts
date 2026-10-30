/**
 * 叙事覆盖层装配器：把一个宿主的覆盖层表面变成可运行的叙事覆盖层。
 *
 * **解决的问题**：把叙事能力嵌入已有游戏（2D/3D 引擎）时，宿主需要自行实现一份
 * 参考宿主的渲染接线（五层视图模型 + 状态投影 + 打字机 + 帧循环 + 输入判据）。
 * 本装配器把这套接线收进展示层：宿主只给一个覆盖层表面（`OverlaySurface`）与一个引擎实例。
 *
 * **设计约束（与引擎架构一致）**：
 * - 引擎核心**不驱动帧**（帧归宿主），本装配器就是那个宿主：它持帧循环，
 *   只做插值，不逐帧写状态（帧级高频键由引擎自己的静默写通道负责）。
 * - 渲染落点全部经端口（`surface.setDialogue` / `setChoices` / `pushNotification` /
 *   `setLayerZ`），本模块不出现任何平台类型；层骨架由宿主的实现建。
 * - 模板注册表可选注入，不传即内建默认（模板只决定「长什么样」）。
 * - **不自行绑定键盘**：宿主游戏的键位归宿主。本层只提供判据与命令入口，
 *   并复用展示层唯一的输入判据（`isGameInputTarget`），不另立第二份口径。
 *
 * **不做什么**：不创建引擎、不装配平台端口（存档/资源/音频是平台能力，由宿主
 * 经引擎选项注入）、不改叙事语义。
 *
 * 本模块只做**装配、接线与销毁编排**：各职责的实现分别在同目录的
 * `projector` / `*-view`（视图模型）/ `element-tree` / `layer-z` 内，
 * 帧循环则复用展示层的共享实现（`../host/frame-loop`，与各宿主的 `startHostFrameLoop` 同一份）。
 * 所有状态都由各职责的工厂持有（每次调用装配器产出独立的一份），
 * 因此两个覆盖层实例互不串扰。
 */
import { createStateReader, DEFAULT_LAYER_Z } from "@lingfan-engine/core";
import type { LayerZTable } from "@lingfan-engine/core";
import { isGameInputTarget } from "../input/scope";
import { createElementRegistry } from "../element/registry";
import type { ElementRegistry } from "../element/registry";
import { registerBuiltinElementRenderers } from "../element";
import { DEFAULT_NOTIFY_MS, DEFAULT_TEXT_CPS } from "../host/duration";
import { choicesLayerView } from "./choices-view";
import type { ChoicesViewDeps } from "./choices-view";
import { dialogueLayerView } from "./dialogue-view";
import type { DialogueViewDeps } from "./dialogue-view";
import { createElementTree } from "./element-tree";
import { createFrameLoop } from "../host/frame-loop";
import { createLayerZController } from "./layer-z";
import { notifyLayerItem } from "./notify-view";
import type { NotifyViewDeps } from "./notify-view";
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
 * const surface = createDomOverlaySurface(container);
 * const overlay = createNarrativeOverlay({ surface, engine });
 * engine.start();
 * window.addEventListener("keydown", (e) => {
 *   if (e.key === " " && overlay.shouldConsumeInput(e.target)) overlay.advance();
 * });
 * // 卸载：overlay.dispose();
 * ```
 */
export function createNarrativeOverlay(
  options: NarrativeOverlayOptions,
): NarrativeOverlay {
  const { surface, engine } = options;
  const report = options.onError ?? ((m: string) => console.error(m));
  const layerZ: LayerZTable = options.layerZ ?? DEFAULT_LAYER_Z;
  const reader = createStateReader(engine);

  const elements = options.elementRegistry ?? createBuiltinElementRegistry();
  const textSpeed = options.textSpeed ?? DEFAULT_TEXT_CPS;

  const layerZController = createLayerZController(surface, layerZ);
  // 表面可能由宿主先建（那时还不知道本实例的层默认表）：构造末尾统一下发一次，
  // 此后层默认表与本实例一致；下发幂等，不产生渲染目标。
  layerZController.apply();

  const projector = createProjector({
    reader,
    engine,
    layerZ: layerZController,
    textSpeed,
  });

  const dialogueDeps: DialogueViewDeps = {
    templates: options.dialogueTemplates,
    readTemplateName: () => reader.dialogTemplate(),
  };
  const choicesDeps: ChoicesViewDeps = {
    templates: options.choiceTemplates,
    texts: options.choiceTexts,
  };
  const notifyDeps: NotifyViewDeps = { templates: options.notifyTemplates };

  const elementTree = createElementTree({
    registry: elements,
    port: surface.elements,
    engine,
    commands: options.commands,
    resolveResource: options.resolveResource,
    report,
  });

  // 两条交互出口（DOM 侧的按钮点击与表单提交就是调用点）
  surface.onChoose = (target) => engine.choose(target);
  surface.onSubmitInput = (value) => engine.input(value);

  /** 重渲对话层（正文 HTML 每次现算：打字帧下它就是变化的那部分） */
  function renderDialogueNow(): void {
    const s = projector.state;
    surface.setDialogue(
      dialogueLayerView(
        {
          speaker: s.speaker,
          speakerColor: s.speakerColor,
          dialogFont: s.dialogFont,
          canAdvance: s.canAdvance,
          dialogHidden: s.dialogHidden,
          waiting: s.waiting,
          lineHtml: projector.lineHtml(),
        },
        dialogueDeps,
      ),
    );
  }

  /** 重渲选择层（`null` = 整层隐藏） */
  function renderChoicesNow(): void {
    const s = projector.state;
    surface.setChoices(
      choicesLayerView(
        {
          waiting: s.waiting,
          menuPrompt: s.menuPrompt,
          menuOptions: s.menuOptions,
          inputPrompt: s.inputPrompt,
          inputCandidates: s.inputCandidates,
        },
        choicesDeps,
      ),
    );
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
    if (payload.kind === "notify") {
      surface.pushNotification(
        notifyLayerItem(payload, notifyDeps),
        payload.duration ?? DEFAULT_NOTIFY_MS,
      );
    } else if (payload.kind === "engine.error") report(payload.message);
  });

  // 帧循环的帧能力来自端口：无帧环境下帧源不回调，循环静默不启、功能仍可用
  // 每帧顺序固定——推进打字机（变了才重渲正文），再交宿主做帧驱动表现
  const frameLoop = createFrameLoop({
    frame: surface.frame,
    onTick: (dt) => {
      if (projector.tickTypewriter(dt)) onTyped();
      options.onFrame?.(dt);
    },
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

  function shouldConsumeInput(target: unknown): boolean {
    // 复用展示层唯一判据：控件与 UI 面板内的输入不归叙事
    return isGameInputTarget(target);
  }

  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    frameLoop.stop();
    offState();
    offEvent();
    surface.clear();
  }

  function setRunning(next: boolean): void {
    frameLoop.setRunning(next);
  }

  renderDialogueNow();
  renderChoicesNow();

  return {
    surface,
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

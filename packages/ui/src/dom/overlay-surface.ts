/**
 * 覆盖层端口的 DOM 实现：把每层视图模型落成真实的 `HTMLElement` 树。
 *
 * **本目录是 `packages/ui` 内唯一允许出现 DOM 类型与 DOM 全局的地方**（见 `dom/index.ts`
 * 的文件头规则）。层骨架、类名、标签形状（`<p>` / `<span>` / `<form>`）、`pointer-events`
 * 策略与输入焦点全都归这里——中立核心只给模型。
 *
 * 事件策略（嵌入场景的关键）：**层自身恒不吃事件**（`pointer-events: none`），层里的
 * 实际控件再逐个恢复点击（`clickable`）。于是层内空白区透传给宿主游戏——对话框铺满
 * 视口时，玩家仍能点击对话框之外的地方。
 *
 * 接管层（`lf-takeover`）与转场遮罩（`lf-transition`）是**宿主自己的层**：中立核心从不
 * 驱动它们，这里只按 `LayerZTable` 建出来并交给 `nodes`，宿主往里面挂自己的内容。
 */
import { DEFAULT_LAYER_Z, resolveInstanceZ } from "@lingfan/engine";
import type { LayerZTable } from "@lingfan/engine";
import type { FrameSource } from "../host/frame-loop";
import type {
  ChoicesLayerView,
  DialogueLayerView,
  NotifyLayerItem,
  OverlayLayerId,
  OverlaySurface,
} from "../overlay/surface";
import { createDomRenderPort } from "./materialize";

/** 覆盖层挂载点（Web 侧宿主落地形态；中立契约见 `OverlaySurface`） */
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

/** DOM 实现：中立端口 + Web 宿主可直取的层节点 */
export interface DomOverlaySurface extends OverlaySurface {
  /** 层节点表（宿主可进一步定制，如往 takeover 里挂自己的 iframe/canvas） */
  readonly nodes: NarrativeMounts;
}

/** 建一个铺满父容器的层（层自身不吃事件） */
function layer(parent: HTMLElement, className: string, z: number): HTMLElement {
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
 * 造一个以窗口 `requestAnimationFrame` 为底的帧源。
 *
 * 无 rAF 的环境（测试 / 降级）下 `request` 返回 0 且**永不回调**：帧循环因此静默不启，
 * 功能仍可用（整句直出、按钮照常工作），只是打字机不走帧。
 *
 * 首次 `request` 用建端口时读到的窗口，其后每次重读——沿用原覆盖层「启动读一次、
 * 之后每帧重读」的语义（宿主换文档时仍取当帧的窗口）。
 */
function createWindowFrameSource(container: HTMLElement): FrameSource {
  const first = container.ownerDocument.defaultView;
  let started = false;
  return {
    request(callback: (now: number) => void): number {
      const view = started ? container.ownerDocument.defaultView : first;
      started = true;
      if (view === null || view === undefined) return 0;
      return view.requestAnimationFrame(callback);
    },
    cancel(handle: number): void {
      if (handle === 0) return;
      container.ownerDocument.defaultView?.cancelAnimationFrame(handle);
    },
  };
}

/**
 * 装配一个 DOM 覆盖层表面：按 `LayerZTable` 在父容器内建出各层，并交出端口。
 *
 * 创建顺序即 DOM 叠放顺序（后建的默认盖在先建的之上），z 值显式写在层样式里，因此
 * 这里不依赖创建顺序表达层级。`takeover` 与 `choices` 初始不占位（外部系统挂载、
 * 或进入选择等待时才显示）。`container` 只用于建层与取窗口，随后不再被引用。
 */
export function createDomOverlaySurface(
  container: HTMLElement,
  layerZ: Partial<LayerZTable> = {},
): DomOverlaySurface {
  // 入参是「工程覆盖」而非完整表：与内建默认合并后再逐层解析（与旧 mounts.ts 同口径）。
  const table: LayerZTable = { ...DEFAULT_LAYER_Z, ...layerZ };
  const root = layer(container, "lf-overlay", 0);
  const stage = layer(
    root,
    "lf-stage",
    resolveInstanceZ("stage", undefined, table),
  );
  const elementLayer = layer(stage, "lf-element-layer", 0);
  const transition = layer(
    root,
    "lf-transition",
    resolveInstanceZ("video", undefined, table),
  );
  const dialogue = layer(
    root,
    "lf-dialogue",
    resolveInstanceZ("dialogue", undefined, table),
  );
  const choices = layer(
    root,
    "lf-choices",
    resolveInstanceZ("choices", undefined, table),
  );
  const takeover = layer(
    root,
    "lf-takeover",
    resolveInstanceZ("minigame", undefined, table),
  );
  const overlay = layer(
    root,
    "lf-notifications",
    resolveInstanceZ("notifications", undefined, table),
  );
  // 接管层空闲时不占位（外部系统挂载时才显示）
  takeover.style.display = "none";
  choices.style.display = "none";

  const nodes: NarrativeMounts = {
    root,
    stage,
    elementLayer,
    dialogue,
    choices,
    overlay,
    takeover,
    transition,
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  /** 层位 → 节点（z 下发与「哪一层」的唯一映射处） */
  const byLayer: Record<OverlayLayerId, HTMLElement> = {
    stage,
    element: elementLayer,
    transition,
    dialogue,
    choices,
    takeover,
    notifications: overlay,
  };

  const doc = (): Document => container.ownerDocument;

  const surface: DomOverlaySurface = {
    frame: createWindowFrameSource(container),
    stage: createDomRenderPort(stage),
    elements: createDomRenderPort(elementLayer),
    nodes,

    setLayerZ(layerId: OverlayLayerId, z: number): void {
      byLayer[layerId].style.zIndex = String(z);
    },

    setDialogue(view: DialogueLayerView): void {
      dialogue.className = `lf-dialogue ${view.rootClass}`;
      dialogue.innerHTML = "";
      if (view.speakerHtml !== "") {
        const speaker = doc().createElement("p");
        speaker.className = "lf-speaker";
        speaker.innerHTML = view.speakerHtml;
        if (view.speakerColor !== "") speaker.style.color = view.speakerColor;
        dialogue.appendChild(speaker);
      }
      const body = doc().createElement("p");
      body.className = "lf-text";
      body.innerHTML = view.bodyHtml;
      if (view.bodyFont !== "") body.style.fontFamily = `'${view.bodyFont}'`;
      dialogue.appendChild(body);
      if (view.hintHtml !== "") {
        const hint = doc().createElement("span");
        hint.className = "lf-hint";
        hint.innerHTML = view.hintHtml;
        dialogue.appendChild(hint);
      }
      // 隐藏而非清空：恢复时不会闪一下
      dialogue.style.display = view.visible ? "" : "none";
    },

    setChoices(view: ChoicesLayerView | null): void {
      choices.style.display = view === null ? "none" : "";
      choices.innerHTML = "";
      if (view === null) return;

      if (view.input !== null) {
        const prompt = view.input.prompt;
        choices.className = "lf-choices";
        const label = doc().createElement("p");
        label.className = "lf-prompt";
        label.textContent = prompt;
        const form = doc().createElement("form");
        form.className = "lf-input-row";
        const field = clickable(doc().createElement("input"));
        field.type = "text";
        field.setAttribute("aria-label", prompt === "" ? "输入" : prompt);
        const submit = clickable(doc().createElement("button"));
        submit.type = "submit";
        submit.textContent = view.input.submitText;
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          // 出口由装配器挂上；未挂时不消费（不是本层的错，故不报错）
          surface.onSubmitInput?.(field.value.trim());
        });
        form.append(field, submit);
        choices.append(label, form);
        return;
      }

      choices.className = `lf-choices ${view.rootClass}`;
      if (view.promptHtml !== "") {
        const prompt = doc().createElement("p");
        prompt.className = "lf-prompt";
        prompt.innerHTML = view.promptHtml;
        choices.appendChild(prompt);
      }
      const row = doc().createElement("div");
      row.className = "lf-choice-row";
      for (const option of view.options) {
        const button = clickable(doc().createElement("button"));
        button.type = "button";
        button.innerHTML = option.html;
        // innerHTML 内容不进无障碍名计算（等价于 v-html）：显式给可访问名
        button.setAttribute("aria-label", option.label);
        // 点击交核心 choose（目标是列 id，不是显示文本）
        button.addEventListener("click", () =>
          surface.onChoose?.(option.target),
        );
        row.appendChild(button);
      }
      choices.appendChild(row);
    },

    pushNotification(item: NotifyLayerItem, durationMs: number): void {
      const node = doc().createElement("div");
      node.className = item.rootClass;
      node.innerHTML = item.bodyHtml;
      overlay.appendChild(node);
      const timer = setTimeout(() => {
        timers.delete(timer);
        node.remove();
      }, durationMs);
      timers.add(timer);
    },

    clear(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      root.remove();
    },
  };
  return surface;
}

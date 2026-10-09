/**
 * 引擎订阅：把状态变更与出站事件翻译成本宿主的视图调用，并管好舞台元素层。
 *
 * 状态键怎么解读、缺省怎么回退，收在展示层的状态分发器里（`createStateView`）——
 * 本文件只做两件事：给出本宿主订阅的键表，以及把每条**视图意图**落到自己的视图上。
 *
 * 元素层（`SYS.elements`）一并在此：它是同一路状态变更的落点，且两处都要 fail-closed
 * 上报——**元素类型未注册**与**元素命令未注册**都不静默跳过，作者写了却看不见效果，
 * 比报一行错难查得多。
 *
 * 出站事件按 `payload.kind` 分派：致命错误写错误条，提示类走 toast，存档类给回执，
 * 小游戏挂载换一条可见的 fail-closed 提示（模板不带注册表，不伪造完成）。
 */

import {
  SYS,
  instanceZLayer,
  type ElementInstance,
  type OutboundPayload,
  type ResourcePort,
  type StoryEngine,
} from "@lingfan/engine";
import {
  createCommandRegistry,
  createElementRegistry,
  createElementResourceResolver,
  createStateView,
  registerBuiltinElementRenderers,
  renderElementTree,
  resolveElementAction,
  type LayerView,
  type StateIntent,
  type TypingSetting,
} from "@lingfan/ui";
import type { StageDom } from "./stage-dom";
import type { DialogueView } from "./dialogue-view";

/** 宿主订阅的状态键表：与引擎的键名一一对应，换键名只改这里 */
const STATE_KEYS = {
  speaker: SYS.currentDialogSpeaker,
  dialogText: SYS.currentDialogText,
  waiting: SYS.waiting,
  nvlMode: SYS.nvlMode,
  nvlBuffer: SYS.nvlBuffer,
  menuOptions: SYS.menuOptions,
  menuTargets: SYS.menuTargets,
  dialogVisible: SYS.dialogVisible,
  elements: SYS.elements,
} as const;

/**
 * 订阅接线的输入：节点句柄表、引擎、以及本宿主已有的几个视图与出口。
 * 本文件只做「引擎说什么 → 谁去落 DOM」的分发，不自己实现任何渲染。
 */
export interface HostWiringOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 引擎：订阅、状态读取与元素命令面的落地 */
  engine: StoryEngine;
  /** 层级视图：实例级 z 的收纳 */
  layers: LayerView;
  /** 对话视图：对话 / 等待 / 选项 / NVL 的落点 */
  dialogue: DialogueView;
  /** 资源端口：元素资源的逻辑寻址 */
  resources: ResourcePort;
  /** 提示条 */
  toast(text: string): void;
  /** 诊断出口（页面错误条 + 控制台） */
  reportError(message: string): void;
  /** 读当前故事级打字机设置 */
  readTypingSetting(): TypingSetting | undefined;
  /** 存档 / 读档完成后的显式对齐（音频与视频渲染器） */
  syncMedia(): void;
}

/** 接线状态订阅、元素层与出站事件 */
export function wireEngine(options: HostWiringOptions): void {
  const { dom, engine, layers, dialogue, resources, reportError } = options;

  // —— 舞台元素层：注册内建渲染器，装配命令表与资源解析 ——
  const elementRegistry = createElementRegistry();
  registerBuiltinElementRenderers(elementRegistry);
  // 元素 `cmd` 的业务命令注册表：未注册 fail-closed（不静默吞掉）
  const commands = createCommandRegistry();
  let elements: readonly ElementInstance[] = [];

  // 资源解析缓存 = @lingfan/ui 共用实现（宿主只提供端口与重渲染回调）
  const elementResources = createElementResourceResolver({
    resolve: (path) => resources.resolve(path),
    onResolved: () => renderElements(),
  });

  /** 意图 → 命令：`nav` → 核心 navigate；`cmd` → 宿主命令注册表（`value` 点击时插值） */
  function activateElement(element: ElementInstance): void {
    const action = resolveElementAction(element.props);
    if (action.kind === "nav") {
      engine.navigate(action.target);
      return;
    }
    if (action.kind !== "cmd") return;
    const handler = commands.get(action.name);
    if (handler === undefined) {
      reportError(`元素命令未注册：${action.name}（宿主需经命令注册表提供）`);
      return;
    }
    handler(
      action.value === undefined ? undefined : engine.interpolate(action.value),
      element,
    );
  }

  function renderElements(): void {
    renderElementTree({
      registry: elementRegistry,
      container: dom.stage,
      elements,
      activate: activateElement,
      resolveResource: elementResources.resolveForElement,
      onUnknownType: (type) => reportError(`元素类型未注册：${type}`),
    });
  }

  // —— 状态变更 → 视图意图 → 本宿主的落点 ——
  const toIntent = createStateView({
    keys: STATE_KEYS,
    resolveLayer: (key) => instanceZLayer(key),
    readTypingSetting: () => options.readTypingSetting(),
    readCharacterColor: (name) => {
      const color = engine.getCharacter(name)?.color;
      return typeof color === "string" ? color : null;
    },
  });

  /** 一条视图意图落到本宿主（分支与状态键一一对应） */
  function applyIntent(intent: StateIntent): void {
    switch (intent.kind) {
      case "layer":
        layers.setOverride(intent.layer, intent.z);
        layers.apply();
        if (intent.layer === "video") layers.applyVideo(); // 视频层在端口内部
        return;
      case "speaker":
        dom.speaker.textContent = intent.text;
        dom.speaker.style.color = intent.color ?? "";
        return;
      case "dialog-text":
        dialogue.setDialogText(intent.text, intent.setting);
        return;
      case "waiting":
        dialogue.setWaiting(intent.waiting);
        return;
      case "nvl-mode":
        dialogue.setNvlMode(intent.mode);
        return;
      case "nvl-buffer":
        dialogue.setNvlBuffer(intent.lines);
        return;
      case "choices":
        dialogue.setMenuChanged();
        return;
      case "dialog-visible":
        dialogue.setDialogVisible(intent.hidden);
        return;
      case "elements":
        elements = intent.elements;
        renderElements();
        return;
      case "none":
        return;
    }
  }

  engine.onStateChanged(({ key, value }) => {
    applyIntent(toIntent(key, value));
  });

  /** 出站事件：致命错误 / 提示 / 小游戏挂载 / 存档回执 */
  function applyEvent(payload: OutboundPayload): void {
    switch (payload.kind) {
      case "engine.error":
        dom.error.textContent = `[${payload.code}] ${payload.message}`;
        console.error(`[engine] ${payload.code}: ${payload.message}`);
        return;
      case "notify":
        options.toast(payload.text);
        return;
      case "minigame.mount":
        dialogue.setMinigame(payload.game);
        return;
      case "save.done":
        options.toast(`已保存到 ${payload.slot}`);
        return;
      case "load.done":
        options.toast(`已读取 ${payload.slot}`);
        options.syncMedia();
        return;
      default:
        return;
    }
  }

  engine.onEvent(({ payload }) => {
    applyEvent(payload);
  });
}

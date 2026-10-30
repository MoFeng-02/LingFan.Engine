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
  type GameStateWriter,
  type OutboundPayload,
  type PlayerPreferences,
  type ResourcePort,
  type StoryEngine,
} from "@lingfan-engine/core";
import {
  createCommandRegistry,
  createElementRegistry,
  createElementResourceResolver,
  createDomRenderPort,
  createStateView,
  registerBuiltinElementRenderers,
  renderElementTree,
  resolveElementAction,
  routeElementValueChange,
  type LayerView,
  type StateIntent,
  type TypingSetting,
} from "@lingfan-engine/ui";
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
  // 输入候选：到达也走 choices 意图（否则候选要等下一次 waiting 变化才出现）
  inputOptions: SYS.inputOptions,
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
  /**
   * 玩家偏好：元素 `cmd="volume:<通道>"` 的回写落点。
   *
   * 可选——宿主没接偏好层时音量回写无落点（上报诊断，不静默吞），
   * 与「宿主没接回写通道，控件仍可拖但值不落地」同一口径。
   */
  preferences?: PlayerPreferences;
  /**
   * 外部玩法状态写入面（引擎实例的 `gameState`）：元素 `cmd="game.<系统>.<键>"` 的落点。
   *
   * 只经 `setScoped` 走 `game.` 命名空间——保留键由引擎写入契约物理挡住，
   * 元素层不可能靠这条通道碰到 `__` 系统状态。
   */
  gameState?: GameStateWriter;
  /**
   * UI 挂载落点（可选）：`SYS.mounts` 的每次变化都会推给它。
   *
   * 与元素层同属「同一路状态变更的另一个落点」，但两者不是一回事：元素是引擎排布的
   * 舞台节点，UI 是宿主渲染树上的组件。这里只给一个**写入回调**而不是渲染器，
   * 是因为三种宿主形态的落法完全不同（原生 DOM 自己算差量，Vue / React 进各自的
   * 响应式系统）——接线的共同点只有「值从哪来」，落法留给装配处。
   * 不给则 `mount` 命令只改状态，没有任何组件出现——降级是「少功能」，不是错误。
   */
  mounts?: (raw: unknown) => void;
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

  // 资源解析缓存 = @lingfan-engine/ui 共用实现（宿主只提供端口与重渲染回调）
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

  /**
   * 控件值回写：元素层只交 `(element, value)`，落点判定在 `element-writeback`。
   *
   * **本函数不碰状态**——它把两件既有闸门（偏好 `setVolume` / `gameState.setScoped`）
   * 交给落点路由，保留键与 JSON 安全仍由引擎写入契约把关。
   */
  function writeElementValue(
    element: ElementInstance,
    value: number | string | boolean,
  ): void {
    const preferences = options.preferences;
    const gameState = options.gameState;
    routeElementValueChange(element, value, {
      setVolume: (channel, next) => {
        // 偏好层没接时音量回写无处可落：宁可报一行诊断，也不假装写成功
        if (preferences === undefined) {
          reportError(
            `元素 ${String(element.id)} 的音量回写没有偏好层：宿主未接线 PlayerPreferences`,
          );
          return;
        }
        preferences.setVolume(channel, next);
      },
      setScoped: (systemId, key, next) => {
        if (gameState === undefined) {
          reportError(
            `元素 ${String(element.id)} 的状态回写没有写入面：宿主未接线 gameState`,
          );
          return false;
        }
        return gameState.setScoped(systemId, key, next);
      },
      reportError,
    });
  }

  function renderElements(): void {
    renderElementTree({
      registry: elementRegistry,
      port: createDomRenderPort(dom.stage),
      elements,
      activate: activateElement,
      onElementValueChange: writeElementValue,
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

  // UI 挂载单独一路：`SYS.mounts` 不在状态分发器的键表里——那张表是「引擎状态 → 视图意图」
  // 的翻译，而挂载没有统一的视图意图可译（三形态落法完全不同），只把值原样交出去。
  // 首帧主动喂一次：订阅不回放历史，引擎可能在接线之前就写过。
  const onMounts = options.mounts;
  if (onMounts !== undefined) {
    onMounts(engine.get(SYS.mounts));
    engine.onStateChanged(({ key, value }) => {
      if (key === SYS.mounts) onMounts(value);
    });
  }

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

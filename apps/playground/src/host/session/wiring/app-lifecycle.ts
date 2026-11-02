/**
 * 引擎生命周期、帧驱动与对局会话的宿主侧总装：把「造引擎并接线 → 起帧循环 → 装会话 →
 * 接暂停态落点 → 登记业务命令」这条序列固定成一趟，卸载顺序也一并收在这里。
 *
 * 装配次序是接线契约，不能随手调整：
 * ① 生命周期叶子先造（无构造期副作用，只闭包持有各单元格）；
 * ② `initEngine()` 立刻执行——引擎构造、state/event 订阅与媒体渲染器在这里一次接齐；
 * ③ 帧循环起在会话之前（会话的「开始」只推进页面态，与帧推进无先后依赖）；
 * ④ 会话随后装：它要拿引擎的进出对局动作与舞台适配回调；
 * ⑤ 暂停态落点在会话就绪后才接上——引擎可能早于会话装配就报出暂停态，故落点是一个
 *    可换的目标（`pausedSink.apply`）；未接上之前的报价不落页面（对局未开始，无遮罩可同步）。
 *
 * 卸载顺序同样固定：订阅解除 → 会话挂载订阅解除 → 偏好退订与末次落盘 → 先停播再释放
 * 已解析资源 → 引擎释放 → 停帧循环。窗口级监听由组件自己成对注销（见调用方）。
 */

import type { Ref } from "vue";
import type {
  HostControls,
  LayerId,
  OutboundPayload,
  StoryEngine,
} from "@lingfan-engine/core";
import type { createCommandRegistry } from "@lingfan-engine/ui";
import {
  createAppEngineLife,
  type AppEngineLife,
} from "../../engine/app-engine";
import { createAppFrame, type AppFrame } from "../../stage/frame/app-frame";
import { browserFrameSource } from "../../stage/frame/frame-loop";
import { createAppSession, type AppSession } from "../app-session";
import { attachAppUiHooks } from "../app-ui-hooks";
import type { AppProps } from "../app-props";
import type { AppMedia } from "../../stage/media/app-media";
import type { VueNarrativeState } from "../../narrative/runtime/narrative-state";
import type { TypewriterHandle } from "../../narrative/wiring/app-narrative";

/** 引擎句柄：取用与整体替换（重启重建后取用仍指向当前实例） */
export interface AppLifecycleEngine {
  get: () => StoryEngine;
  set: (engine: StoryEngine) => void;
}

/** 视图单元格：叙事状态、媒体、错误横幅、语言、层 z 与打字机 */
export interface AppLifecycleView {
  narrative: VueNarrativeState;
  media: AppMedia;
  error: Ref<string>;
  currentLang: Ref<string>;
  zOf: (layer: LayerId) => number;
  typewriter: TypewriterHandle;
}

/** 接线回调：引擎状态/事件订阅落点与宿主侧命令、偏好句柄 */
export interface AppLifecycleWiring {
  handleState: (event: { key: string; value: unknown }) => void;
  handleEvent: (event: { payload: OutboundPayload }) => void;
  commands: ReturnType<typeof createCommandRegistry>;
  prefs: { dispose: () => void };
}

/** DOM 落点：元素层、转场遮罩与震动层 */
export interface AppLifecycleDom {
  elementLayerEl: Ref<HTMLElement | null>;
  transitionEl: Ref<HTMLElement | null>;
  shakeEl: Ref<HTMLElement | null>;
}

/** 取用与动作：舞台推进、适配重算与两个容器读取 */
export interface AppLifecycleActions {
  advance: () => void;
  applyStageFit: () => void;
  readMinigameHost: () => HTMLElement | null;
  readVideoContainer: () => HTMLElement | null;
}

/** 会话入参：操作通道与两个面板动作（业务命令登记共用） */
export interface AppLifecycleSession {
  controls: HostControls;
  toggleHistory: () => void;
  showPrefs: Ref<boolean>;
}

/** 装配入参：宿主属性、引擎句柄与上面五组取用 */
export interface AppLifecycleOptions {
  /** 组合根注入的宿主属性（引擎构造、端口重建、挂载表与会话壳配置消费） */
  props: AppProps;
  engine: AppLifecycleEngine;
  view: AppLifecycleView;
  wiring: AppLifecycleWiring;
  dom: AppLifecycleDom;
  actions: AppLifecycleActions;
  session: AppLifecycleSession;
}

/** 装配结果：引擎生命周期、帧循环句柄、对局会话与卸载动作 */
export interface AppLifecycle extends AppEngineLife, AppFrame, AppSession {
  /** 卸载：订阅解除 → 会话解除 → 偏好退订落盘 → 停播释放 → 引擎释放 → 停帧循环 */
  teardown: () => void;
}

/** 装配引擎生命周期与对局会话：引擎 → 帧循环 → 会话 → 暂停态落点 → 业务命令登记 */
export function createAppLifecycle(options: AppLifecycleOptions): AppLifecycle {
  const { props, engine, view, wiring, dom, actions, session: shell } = options;
  const { narrative, media, error, currentLang, zOf, typewriter } = view;
  /** 暂停态回写的落点：引擎可能早于会话装配就报出暂停态，这里留一个可换的目标 */
  const pausedSink: { apply?: (paused: boolean) => void } = {};
  const engineLife = createAppEngineLife({
    props,
    getEngine: engine.get,
    setEngine: engine.set,
    media,
    narrative,
    currentLang,
    error,
    elementLayerEl: dom.elementLayerEl,
    typewriter,
    zOf,
    handleState: wiring.handleState,
    handleEvent: wiring.handleEvent,
    readMinigameHost: actions.readMinigameHost,
    readVideoContainer: actions.readVideoContainer,
    onMounts: props.onMounts,
    onPaused: (value: boolean) => pausedSink.apply?.(value),
  });
  engineLife.initEngine();
  const { frameLoop } = createAppFrame({
    getEngine: engine.get,
    frame: browserFrameSource(),
    narrative,
    media,
    typewriter,
    elementLayerEl: dom.elementLayerEl,
    transitionEl: dom.transitionEl,
    shakeEl: dom.shakeEl,
  });
  const session = createAppSession({
    controls: shell.controls,
    mounts: props.mounts,
    mountsTable: props.mountsTable,
    saves: props.saves,
    savePort: props.savePort,
    enterGame: engineLife.enterGame,
    continueGame: engineLife.continueGame,
    advance: actions.advance,
    applyStageFit: actions.applyStageFit,
  });
  // 会话就绪后接上引擎暂停态的落点：此后挂载 UI 或工具栏暂停，遮罩同样会出来
  pausedSink.apply = session.syncPaused;
  // 调试标志与元素 `cmd` 的业务命令登记（history / prefs / restart 三支）
  attachAppUiHooks({
    inGame: session.inGame,
    commands: wiring.commands,
    toggleHistory: shell.toggleHistory,
    showPrefs: shell.showPrefs,
    restart: engineLife.restart,
  });
  /** 卸载：订阅解除 → 会话解除 → 偏好退订落盘 → 先停播再释放 → 引擎释放 → 停帧循环 */
  function teardown(): void {
    engineLife.unbind(); // 订阅解除（与 bindEngine 成对；先于媒体与引擎释放）
    session.dispose(); // 挂载表订阅解除（与 setup 期的 subscribe 成对）
    wiring.prefs.dispose(); // 退订偏好变更（与构造期订阅成对）
    props.preferences.dispose(); // 补发未落盘的末次偏好修改（防抖尾结算）
    media.audioPort.dispose(); // 先停播
    media.videoPort.dispose();
    media.audioRenderer?.dispose(); // 再释放已解析资源
    engine.get().dispose(); // 清挂起的 wait 定时器
    frameLoop.stop(); // 停 rAF 帧循环
  }
  return { ...engineLife, frameLoop, ...session, teardown };
}

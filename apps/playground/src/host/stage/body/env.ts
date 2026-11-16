/**
 * 身体的运行环境：把引擎的读面、写面与舞台读数包成组件能用的 `SceneEnv`。
 *
 * 组件不 import 引擎：它拿到的就是这个对象。这么做有两个后果，都是想要的：
 * ① 组件换宿主（浏览器 / 小程序 / 编辑器预览）时只需要宿主把同一个接口填出来；
 * ② 组件想读什么、能写什么全由这里决定——写面只开放 `game.<systemId>.<key>`，
 * 组件拿不到 `SYS` 键，也就改不了「这一屏由谁画」这类宿主专属状态。
 *
 * 舞台读数不是组件自己量的：宿主刷完适配后把 `{ viewport, layout }` 就地写进
 * 一个可变对象，组件经 `stage()` 读当次值。组件侧不得缓存这个返回值——它随窗口
 * 变化而变，缓存下来的旧值会在缩放后把热区对偏。
 */
import {
  SYS,
  gameScopedKey,
  type ReadonlyGameState,
  type SceneEnv,
  type StageLayout,
  type StageViewport,
  type StoryCommand,
  type StoryEngine,
} from "@lingfan-engine/core";

/** 舞台读数：视口尺寸与由它算出的适配结果，两者必须来自同一次读数 */
export interface SceneStageState {
  viewport: StageViewport;
  layout: StageLayout;
}

/** 环境装配入参 */
export interface SceneEnvOptions {
  /** 引擎实例取用（重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 舞台读数取用（宿主适配重算后就地更新） */
  readStage: () => SceneStageState;
}

/** 装配环境：读面只转发引擎查询，写面只开放玩法系统的命名空间 */
export function createSceneEnv(options: SceneEnvOptions): SceneEnv {
  const { getEngine, readStage } = options;
  /** 只读状态面：`getScoped` 走作用域化键，组件不必知道键怎么拼 */
  const state: ReadonlyGameState = {
    get: (key: string): unknown => getEngine().get(key),
    getScoped: (systemId: string, key: string): unknown =>
      getEngine().gameState.get(gameScopedKey(systemId, key)),
  };
  return {
    get: (key: string): unknown => getEngine().get(key),
    state,
    columns: () => getEngine().columns(),
    // 当前列是系统键，读到非字符串（尚未进列）时交空串：调用方按「不在任何列」处理
    currentColumn: (): string => {
      const current = getEngine().get(SYS.currentSceneColumn);
      return typeof current === "string" ? current : "";
    },
    historyLength: (): number => getEngine().historyLength(),
    historyCursor: (): number => getEngine().historyCursor(),
    interpolate: (source: string): unknown => getEngine().interpolate(source),
    // 引擎报的是状态变更明细；组件要的只是「有东西变了」，所以在此收窄成无参回调
    onChange: (listener: () => void): (() => void) =>
      getEngine().onStateChanged(() => {
        listener();
      }),
    onEvent: (listener) => getEngine().onEvent(listener),
    submit: (ops: readonly StoryCommand[]): boolean =>
      getEngine().submitSceneOps(ops),
    call: (target: string): boolean =>
      getEngine().submitSceneOps([{ op: "call", target }]),
    navigate: (columnId: string): void => getEngine().navigate(columnId),
    write: (systemId: string, key: string, value: unknown): boolean =>
      getEngine().gameState.setScoped(systemId, key, value),
    writeSilent: (systemId: string, key: string, value: unknown): boolean =>
      getEngine().gameState.setScopedSilent(systemId, key, value),
    stage: () => readStage(),
  };
}

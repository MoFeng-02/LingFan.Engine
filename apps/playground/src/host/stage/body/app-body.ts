/**
 * 身体层的宿主侧装配：把引擎、组件表、错误条与舞台读数接成一个身体层。
 *
 * 与元素层的差别在落点上：元素层自己往容器里渲染（容器由模板 ref 提供），身体层
 * 不碰 DOM——组件由 Vue 的渲染树持有，所以这里只把「选出来的是什么」回调给组合根，
 * 由模板里的 `<component :is>` 承载。因此本文件没有 `containerEl` 入参：没有容器，
 * 只有回调。
 *
 * 订阅不在这里：引擎实例会在重启时整体重建，订阅点必须跟着重建走，所以由生命周期
 * 总装（`app-engine` 的 `bindEngine`）持有并转发——这里只交出「重选一次」的动作。
 */
import type { Ref } from "vue";
import type { SceneEnv, StoryEngine } from "@lingfan-engine/core";

import { createBodyLayer, type BodyView } from "./body.ts";
import { createSceneEnv, type SceneStageState } from "./env.ts";

/** 装配入参 */
export interface AppBodyLayerOptions {
  /** 生成物里的场景表（构建期产物，键就是 `SYS.body.name`） */
  table: Readonly<Record<string, unknown>>;
  /** 错误横幅内容：表里缺组件时由身体层写入 */
  error: Ref<string>;
  /** 引擎实例取用（重启重建后指向新实例） */
  getEngine: () => StoryEngine;
  /** 舞台读数取用（宿主适配重算后就地更新） */
  readStage: () => SceneStageState;
  /** 选出/清空这一屏的身体时回调：组合根据此更新渲染树 */
  onSelect: (view: BodyView | null) => void;
}

/** 身体层句柄 */
export interface AppBodyLayer {
  /** 交给每个身体的运行环境（同一份引用，组件之间不共享可变状态） */
  readonly env: SceneEnv;
  /** 重新读一次 `SYS.body` 并交出新结果（无身体时交出 `null`） */
  render(): void;
  /** 放手：此后不再回调组合根 */
  dispose(): void;
}

/** 装配身体层：环境 + 选择 + 回调，三者一次性接好 */
export function createAppBodyLayer(options: AppBodyLayerOptions): AppBodyLayer {
  const { table, error, getEngine, readStage, onSelect } = options;
  const env = createSceneEnv({ getEngine, readStage });
  const layer = createBodyLayer({ table, env, error, getEngine, onSelect });
  return {
    env,
    render: (): void => {
      layer.render();
    },
    dispose: (): void => {
      layer.dispose();
    },
  };
}

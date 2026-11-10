/**
 * 舞台适配接线：把「设计基准 × 缩放策略」算出的布局落到舞台根上，并跟着窗口变化重算。
 *
 * 单独成文件而不是塞进 `boot.ts`：装配顺序的编排与「一类 DOM 写入」是两件事，
 * 混在一起会让装配函数同时负责端口、引擎、面板与几何。
 *
 * 本文件是宿主里唯一注册窗口监听的接线之一：视口尺寸只有平台知道，
 * 适配层（`@lingfan-engine/shell`）刻意不碰全局，因此监听与注销都落在这里，
 * 且必须成对——宿主可能在同一页面被拆除重建（热更新、嵌入式宿主换工程）。
 */

import {
  createStageFitter,
  createStagePort,
  type StageConfig,
} from "@lingfan-engine/shell";
import type { StageDom } from "./stage-dom";

/** 接线句柄：`refresh` 供宿主在必要时主动重量一次，`dispose` 摘掉监听 */
export interface StageFitWiring {
  /** 立刻按当前视口重算并落笔（尺寸没变时不重复写样式） */
  refresh(): void;
  /** 摘掉窗口监听（可重复调用） */
  dispose(): void;
}

/**
 * 接上舞台适配：先落一次布局，再随窗口尺寸与横竖屏变化重落。
 *
 * 视口读的是 `#stage-viewport` 的客户区，不是 `#stage-root`——后者已被缩放，
 * 量它会量到缩放后的尺寸，越量越小。根节点读的是 `#stage-root`，
 * 它是唯一承载缩放与平移的节点；震动层在其内，两层各写各的变换。
 */
export function wireStageFit(options: {
  dom: StageDom;
  config: StageConfig;
}): StageFitWiring {
  const { dom, config } = options;
  const fitter = createStageFitter({
    port: createStagePort({
      readRoot: () => dom.stageRoot,
      readFrame: () => ({
        width: dom.viewport.clientWidth,
        height: dom.viewport.clientHeight,
      }),
    }),
    config,
  });

  const refresh = (): void => {
    fitter.refresh();
  };

  window.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", refresh);
  refresh();

  let disposed = false;
  return {
    refresh,
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", refresh);
      window.removeEventListener("orientationchange", refresh);
    },
  };
}

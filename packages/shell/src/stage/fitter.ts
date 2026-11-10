/**
 * 舞台适配编排：把「读视口 → 算布局 → 必要时落笔」串成一次可重复调用的动作。
 *
 * 平台动作只有两个（`measure` 与 `apply`），计算与判定都在引擎侧——所以这里既不持有
 * 平台对象，也不认任何平台全局。宿主换壳只换端口实现，编排语义不变：同样读数不会
 * 重复落笔，读不出尺寸时宁可什么都不做也不写一组坏数字。
 *
 * 这里不注册任何监听：订阅与注销的时机、成对关系、生命周期在各平台语义不同，归宿主；
 * 本件只暴露一次性的 `refresh()`，由宿主在挂载后与尺寸变化时自行调用。
 */
import {
  DEFAULT_STAGE_CONFIG,
  type StageConfig,
  type StagePort,
} from "@lingfan-engine/core";
import { computeStageLayout } from "./layout.ts";
import type { StageLayout, StageViewport } from "./types.ts";

/** 编排件参数 */
export interface StageFitterOptions {
  /** 平台动作端口：读数与落笔各一个 */
  readonly port: StagePort;
  /** 适配配置（设计基准 + 策略），缺省用引擎内建基准 */
  readonly config?: StageConfig;
  /** 每次真正应用后通知（宿主可据此同步缩略图基准等） */
  readonly onLayout?: (layout: StageLayout) => void;
}

/** 舞台适配编排：算一次落一次，何时算由宿主决定 */
export interface StageFitter {
  /** 读一次、算一次、必要时落一次；返回本次布局（读数非法时返回上次或退化布局） */
  refresh(): StageLayout;
  /** 当前布局（未 refresh 过时为缺省布局） */
  layout(): StageLayout;
}

/** 读数可用：非有限或非正都算读不出——未挂载、隐藏、容器塌缩都会给出这种值 */
function readable(viewport: StageViewport): boolean {
  return (
    Number.isFinite(viewport.width) &&
    Number.isFinite(viewport.height) &&
    viewport.width > 0 &&
    viewport.height > 0
  );
}

/** 等值判定：只比落笔用到的六个数，策略名与派生尺寸不参与 */
function sameGeometry(left: StageLayout, right: StageLayout): boolean {
  return (
    left.scaleX === right.scaleX &&
    left.scaleY === right.scaleY &&
    left.offsetX === right.offsetX &&
    left.offsetY === right.offsetY &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** 缺省布局：视口按设计基准算，读数为「原始尺寸、不缩放、不偏移」 */
function defaultLayout(config: StageConfig): StageLayout {
  return computeStageLayout(
    { width: config.width, height: config.height },
    config,
  );
}

/** 造舞台适配编排：状态全在闭包里，两个实例互不干扰 */
export function createStageFitter(options: StageFitterOptions): StageFitter {
  const config = options.config ?? DEFAULT_STAGE_CONFIG;
  let current = defaultLayout(config);
  let applied: StageLayout | null = null;

  return {
    refresh(): StageLayout {
      const viewport = options.port.measure();
      if (!readable(viewport)) return current;
      const next = computeStageLayout(viewport, config);
      if (applied !== null && sameGeometry(applied, next)) return current;
      options.port.apply(next);
      applied = next;
      current = next;
      options.onLayout?.(next);
      return next;
    },
    layout(): StageLayout {
      return current;
    },
  };
}

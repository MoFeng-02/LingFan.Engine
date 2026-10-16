/**
 * 舞台适配装配：把「外框尺寸 + 基准 + 策略」算成一组变换，写进舞台根。
 *
 * 计算在 `@lingfan/shell`（纯函数、不读平台），读数与落笔在这里——DOM 是宿主的事。
 * 基准宽高也由本装配写入样式，所以配置里换基准就等于整场换坐标系，样式表不需要跟着改。
 * 配置由组合根注入（`project.json shell.stage` 经引擎解析）；未注入才回落到引擎内建基准。
 *
 * 本文件不注册任何窗口监听：`apply()` 由宿主在挂载后与窗口变化时调用。浏览器宿主听
 * `resize`，小程序宿主在系统信息变化时调，两端共用这里同一份套用逻辑（连同变换顺序）。
 */
import { DEFAULT_STAGE_CONFIG, type StageConfig } from "@lingfan/engine";
import {
  computeStageLayout,
  stageTransform,
  type StageLayout,
} from "@lingfan/shell";

/** 舞台适配的装配参数 */
export interface AppStageFitOptions {
  /** 读外框尺寸：容纳舞台的容器的布局宽高（不含已套上的变换，避免越缩越小） */
  readFrame(): { width: number; height: number };
  /** 舞台根：基准宽高、变换原点与变换都写它的行内样式 */
  readStageRoot(): HTMLElement | null;
  /** 适配配置（设计基准 + 策略），缺省用引擎内建基准 */
  config?: StageConfig;
}

/** 舞台适配装配：算一次套一次，重算时机由宿主决定 */
export interface AppStageFit {
  /** 重算并套用；舞台根未挂载时返回 null 且不写任何样式 */
  apply(): StageLayout | null;
}

/** 造舞台适配装配：配置在构造期定型一次，之后每次 apply 都用同一份 */
export function createAppStageFit(options: AppStageFitOptions): AppStageFit {
  const config = options.config ?? DEFAULT_STAGE_CONFIG;
  return {
    apply(): StageLayout | null {
      const root = options.readStageRoot();
      if (root === null) return null;
      const layout = computeStageLayout(options.readFrame(), config);
      root.style.width = `${layout.width}px`;
      root.style.height = `${layout.height}px`;
      // 变换顺序是「先平移再缩放」，原点必须取左上角；写成中心原点会把偏移量也缩放一遍
      root.style.transformOrigin = "0 0";
      root.style.transform = stageTransform(layout);
      return layout;
    },
  };
}

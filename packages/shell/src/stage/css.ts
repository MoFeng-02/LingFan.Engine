/**
 * 舞台适配的 CSS 宿主端口：把「读视口」与「落布局」两件事接到样式写入面上。
 *
 * 宿主装配时注入根节点读法与视口读法，端口自己不认识任何全局；根节点的类型是
 * 契约里的样式写入面（四个字符串属性），真实元素天然满足，这里不需要知道元素是什么。
 *
 * `apply` 只套用、不重算：宽高与变换串都来自传进来的布局结果。写序固定为
 * 宽 → 高 → 变换原点 → 变换：变换串是「先平移再缩放」，原点必须是左上角，
 * 若原点留在中心，偏移量会被再缩放一遍，舞台位置整体跑偏。
 */
import type {
  StageLayout,
  StagePort,
  StageStyleTarget,
  StageViewport,
} from "@lingfan-engine/core";
import { stageTransform } from "./layout.ts";

/** 端口注入项：根节点读法与视口读法由宿主给，端口不持有 */
export interface StageCssPortOptions {
  /** 读舞台根节点（未挂载时返回 null，此时 apply 不写任何样式） */
  readonly readRoot: () => StageStyleTarget | null;
  /** 读当前可用视口（逻辑像素） */
  readonly readFrame: () => StageViewport;
}

/** 造 CSS 宿主端口：读视口直通宿主读法，落布局写四个样式属性 */
export function createStagePort(options: StageCssPortOptions): StagePort {
  return {
    measure(): StageViewport {
      return options.readFrame();
    },
    apply(layout: StageLayout): void {
      const root = options.readRoot();
      if (root === null) return;
      root.style.width = `${layout.width}px`;
      root.style.height = `${layout.height}px`;
      root.style.transformOrigin = "0 0";
      root.style.transform = stageTransform(layout);
    },
  };
}

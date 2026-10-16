/**
 * 本工程的舞台基准：作者按设计基准像素书写元素与控件坐标，演出时整场等比缩放套进外框。
 *
 * 适配模型本身吃得下任意基准与任意策略（见 `@lingfan/shell` 的舞台适配域），这里只写
 * 「本工程取值」这一件事。基准尺寸与策略落成配置对象而不是样式表里的固定 px，是因为
 * 换基准只该改这一处：舞台根的宽高与变换都由装配写进去。
 */
import type { StageConfig } from "@lingfan/shell";

/** 本工程设计基准宽（作者坐标系的宽） */
export const PLAYGROUND_STAGE_WIDTH = 1280;
/** 本工程设计基准高（作者坐标系的高） */
export const PLAYGROUND_STAGE_HEIGHT = 720;
/** 本工程舞台适配配置：完整显示（等比缩放 + 余量居中） */
export const PLAYGROUND_STAGE_CONFIG: StageConfig = {
  width: PLAYGROUND_STAGE_WIDTH,
  height: PLAYGROUND_STAGE_HEIGHT,
  fit: "contain",
};

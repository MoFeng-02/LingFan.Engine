/**
 * 舞台适配计算：把「视口尺寸 + 设计基准 + 适配策略」算成一组可直接套用的变换。
 *
 * 作者按设计基准像素书写元素与控件坐标，演出前由这里算出缩放与偏移，宿主把结果套到
 * 舞台容器上。本模块只做纯计算：不读平台全局、不碰 DOM。视口尺寸由宿主提供——浏览器
 * 宿主读窗口，小程序宿主读系统信息，桌面宿主读窗口内可用区域。
 *
 * 尺寸不可用（视口或基准非正、非有限）时退化为原始尺寸左上角摆放：调用方拿到的仍是
 * 一组可安全套用的数字，而不是 NaN。夹取（`minScale`/`maxScale`）按轴生效，等比策略
 * 下两轴同值，所以夹取不会破坏等比。
 */
import { resolveStagePreset } from "./presets.ts";
import {
  type StageAlign,
  type StageConfig,
  type StageLayout,
  type StageScalePolicy,
  type StageViewport,
} from "./types.ts";

/** 非正或非有限一律按 0 处理：比值算不出来时统一落到退化分支 */
function positiveOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 两轴缩放倍率：`fill` 与固定数字是仅有的两支可能不等比 */
function scaleFactors(
  policy: StageScalePolicy,
  viewport: StageViewport,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const byWidth = viewport.width / width;
  const byHeight = viewport.height / height;
  if (typeof policy === "number") {
    const fixed = Number.isFinite(policy) && policy > 0 ? policy : 1;
    return { x: fixed, y: fixed };
  }
  if (policy === "fill") return { x: byWidth, y: byHeight };
  if (policy === "width") return { x: byWidth, y: byWidth };
  if (policy === "height") return { x: byHeight, y: byHeight };
  if (policy === "max") {
    const longest = Math.max(byWidth, byHeight);
    return { x: longest, y: longest };
  }
  const shortest = Math.min(byWidth, byHeight);
  return { x: shortest, y: shortest };
}

/** 夹取到配置范围：未配置或不合法的一侧不设限 */
function clampScale(
  value: number,
  min: number | undefined,
  max: number | undefined,
): number {
  let scale = value;
  if (typeof min === "number" && Number.isFinite(min) && scale < min) {
    scale = min;
  }
  if (typeof max === "number" && Number.isFinite(max) && scale > max) {
    scale = max;
  }
  return scale;
}

/** 留边方向上的摆放偏移：多出的空间按锚点分给两侧，裁切时偏移为负 */
function alignOffset(
  viewportEdge: number,
  scaledEdge: number,
  align: StageAlign,
): number {
  if (align === "start") return 0;
  if (align === "end") return viewportEdge - scaledEdge;
  return (viewportEdge - scaledEdge) / 2;
}

/** 非有限一律按 0：变换串会直接进 CSS，NaN 会让整条声明被静默丢弃 */
function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** 小数截到六位：变换串进 CSS 与快照判据都要求稳定文本 */
function round6(value: number): number {
  return Math.round(finite(value) * 1e6) / 1e6;
}

/**
 * 把布局结果写成 CSS 变换串：先平移再缩放，原点取舞台容器左上角。
 *
 * 宿主把这一串原样写进舞台容器的 `transform`（并配 `transform-origin: top left`），
 * 于是「作者坐标 → 屏幕坐标」的换算全仓只有 `computeStageLayout` 与本函数这一条路径，
 * 浏览器宿主与小程序宿主不会各写一份变换顺序（顺序错了就变成先缩后移，偏移量会跟着被缩放）。
 */
export function stageTransform(layout: StageLayout): string {
  const x = round6(layout.offsetX);
  const y = round6(layout.offsetY);
  const sx = round6(layout.scaleX);
  const sy = round6(layout.scaleY);
  return `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
}

/** 算一次适配：策略与对齐都是「配置显式值优先，缺省取预设」 */
export function computeStageLayout(
  viewport: StageViewport,
  config: StageConfig,
): StageLayout {
  const viewWidth = positiveOrZero(viewport.width);
  const viewHeight = positiveOrZero(viewport.height);
  const width = positiveOrZero(config.width);
  const height = positiveOrZero(config.height);
  const preset = resolveStagePreset(config.fit);
  const policy = config.scaleBy ?? preset.scaleBy;
  if (viewWidth === 0 || viewHeight === 0 || width === 0 || height === 0) {
    return {
      policy,
      scaleX: 1,
      scaleY: 1,
      width,
      height,
      scaledWidth: width,
      scaledHeight: height,
      offsetX: 0,
      offsetY: 0,
    };
  }
  const factors = scaleFactors(
    policy,
    { width: viewWidth, height: viewHeight },
    width,
    height,
  );
  const scaleX = clampScale(factors.x, config.minScale, config.maxScale);
  const scaleY = clampScale(factors.y, config.minScale, config.maxScale);
  const scaledWidth = width * scaleX;
  const scaledHeight = height * scaleY;
  const alignX = config.alignX ?? preset.alignX;
  const alignY = config.alignY ?? preset.alignY;
  return {
    policy,
    scaleX,
    scaleY,
    width,
    height,
    scaledWidth,
    scaledHeight,
    offsetX: alignOffset(viewWidth, scaledWidth, alignX),
    offsetY: alignOffset(viewHeight, scaledHeight, alignY),
  };
}

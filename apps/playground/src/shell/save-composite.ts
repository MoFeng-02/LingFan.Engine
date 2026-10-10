/**
 * 存档缩略图·真像素分层合成：舞台媒体层（元素图/视频帧）按包围盒映射绘制 +
 * 文字投影叠加。与合成卡（`./thumbnail.ts`）共用输入契约与文字投影。
 * 媒体元素须 CORS 匿名加载（renderers/videoPort 已设 crossOrigin；lfstream 带 ACAO:*）。
 */
import { drawTextOverlay, type SaveThumbnailInput } from "./thumbnail";

/** 舞台真像素媒体层（元素图 / 元素视频 / 覆盖层视频；包围盒相对舞台） */
export interface StageMediaLayer {
  el: HTMLImageElement | HTMLVideoElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 收集舞台真像素媒体层：img/video 包围盒（getBoundingClientRect 含 transform 缩放，
 * DOM 顺序 = 叠放顺序）+ body 直挂的覆盖层视频（videoPort fixed 全屏）。
 * 无帧视频（readyState < 2）与零尺寸跳过。
 */
export function collectStageMedia(stage: HTMLElement | null): StageMediaLayer[] {
  if (stage === null) return [];
  const stageRect = stage.getBoundingClientRect();
  const out: StageMediaLayer[] = [];
  const push = (el: Element): void => {
    if (!(el instanceof HTMLImageElement) && !(el instanceof HTMLVideoElement)) {
      return;
    }
    if (el instanceof HTMLVideoElement && el.readyState < 2) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    out.push({
      el,
      x: r.left - stageRect.left,
      y: r.top - stageRect.top,
      width: r.width,
      height: r.height,
    });
  };
  for (const el of stage.querySelectorAll("img, video")) push(el);
  for (const el of document.body.querySelectorAll("video")) push(el);
  return out;
}

/** 真像素分层合成的输入：缩略图基座参数 + 舞台尺寸（媒体层坐标系基准）+ 媒体层。 */
export interface StageCompositeInput extends SaveThumbnailInput {
  /** 舞台尺寸（px，media 包围盒的坐标系基准） */
  stage: { width: number; height: number };
  /** 真像素媒体层（collectStageMedia 产出；数组顺序 = 绘制顺序） */
  media: StageMediaLayer[];
}

/**
 * 存档缩略图·真像素分层合成：媒体层（元素图/视频帧）按舞台包围盒映射绘制 +
 * 文字投影叠加。合成失败（canvas 被跨源污染等）由调用方降级 captureSaveThumbnail。
 * 近似说明：drawImage 为包围盒拉伸（不还原 object-fit 与旋转），缩略图可接受。
 */
export function captureStageComposite(input: StageCompositeInput): string {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas 2d 上下文不可用");

  const gradient = ctx.createLinearGradient(0, 0, 0, input.height);
  gradient.addColorStop(0, "#1e1e2e");
  gradient.addColorStop(1, "#12121a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, input.width, input.height);

  if (input.stage.width > 0 && input.stage.height > 0) {
    const sx = input.width / input.stage.width;
    const sy = input.height / input.stage.height;
    for (const m of input.media) {
      ctx.drawImage(m.el, m.x * sx, m.y * sy, m.width * sx, m.height * sy);
    }
  }

  drawTextOverlay(ctx, input);

  return canvas.toDataURL("image/jpeg", input.quality);
}

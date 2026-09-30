/**
 * 存档缩略图合成（宿主侧，canvas 2D）：
 * 合成「存档卡」而非像素级截屏——WebView 无跨端截图 API（wry 未暴露
 * WebView2 CapturePreview / WKWebView takeSnapshot），且合成卡确定性可配：
 * 背景（可换工程图）+ 说话人/正文片段 + 时间戳。尺寸/质量/是否带文本由
 * shell.saves.thumbnail 配置（默认见 shell/saves.ts）。
 *
 * 说明：MVP 不含舞台像素（背景图层接入待渲染层暴露快照接口）；文本取纯化后的
 * 说话人与正文（HTML 已剥离）。失败（无 canvas 上下文）抛错由调用方降级为无图存档。
 */

export interface SaveThumbnailInput {
  width: number;
  height: number;
  quality: number;
  showText: boolean;
  /** 存档标题（save op 的 title；缺省用故事名） */
  title?: string;
  /** 当前说话人（纯文本） */
  speaker?: string;
  /** 当前正文（纯文本，已剥离标签） */
  text?: string;
  timestamp: number;
}

/** 剥离富文本标签（对话渲染产物是受控 HTML；此处仅作缩略图纯文本投影） */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export function captureSaveThumbnail(input: SaveThumbnailInput): string {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas 2d 上下文不可用");

  // 背景：纵向渐变（与舞台同色系；后续可由工程提供底图）
  const gradient = ctx.createLinearGradient(0, 0, 0, input.height);
  gradient.addColorStop(0, "#1e1e2e");
  gradient.addColorStop(1, "#12121a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, input.width, input.height);

  drawTextOverlay(ctx, input);

  return canvas.toDataURL("image/jpeg", input.quality);
}

/** 卡片/分层合成共用的文字投影（标题 + 说话人 + 正文折行 + 时间戳） */
function drawTextOverlay(
  ctx: CanvasRenderingContext2D,
  input: SaveThumbnailInput,
): void {
  if (!input.showText) return;
  {
    const pad = Math.round(input.width * 0.06);
    const title = input.title ?? "灵泛引擎";
    ctx.fillStyle = "#7aa2f7";
    ctx.font = `bold ${Math.round(input.height * 0.09)}px sans-serif`;
    ctx.fillText(title, pad, Math.round(input.height * 0.22));

    ctx.fillStyle = "#e6e6f0";
    ctx.font = `${Math.round(input.height * 0.075)}px sans-serif`;
    if (input.speaker) {
      ctx.fillStyle = "#9ece6a";
      ctx.fillText(input.speaker, pad, Math.round(input.height * 0.46));
      ctx.fillStyle = "#e6e6f0";
    }
    const line = (input.text ?? "").replace(/\s+/g, " ").trim();
    const maxWidth = input.width - pad * 2;
    const charSize = Math.round(input.height * 0.07);
    ctx.font = `${charSize}px sans-serif`;
    // 简单逐字符折行（缩略图场景够用；CJK 为主无断词问题）
    let cursorY = Math.round(input.height * 0.46) + (input.speaker ? charSize * 1.8 : 0);
    let cursorX = pad;
    for (const ch of line) {
      if (cursorX + charSize > maxWidth) {
        cursorX = pad;
        cursorY += Math.round(charSize * 1.4);
        if (cursorY > input.height - pad) break;
      }
      ctx.fillText(ch, cursorX, cursorY);
      cursorX += charSize;
    }

    ctx.fillStyle = "#565f89";
    ctx.font = `${Math.round(input.height * 0.06)}px sans-serif`;
    ctx.fillText(
      new Date(input.timestamp).toLocaleString(),
      pad,
      input.height - Math.round(pad * 0.8),
    );
  }
}

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

export interface StageCompositeInput extends SaveThumbnailInput {
  /** 舞台尺寸（px，media 包围盒的坐标系基准） */
  stage: { width: number; height: number };
  /** 真像素媒体层（collectStageMedia 产出；数组顺序 = 绘制顺序） */
  media: StageMediaLayer[];
}

/**
 * 存档缩略图·真像素分层合成：媒体层（元素图/视频帧）按舞台包围盒映射绘制 +
 * 文字投影叠加。合成失败（canvas 被跨源污染等）由调用方降级 captureSaveThumbnail。
 * 媒体元素须 CORS 匿名加载（renderers/videoPort 已设 crossOrigin；lfstream 带 ACAO:*）。
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

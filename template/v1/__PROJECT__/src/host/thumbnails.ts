/**
 * 存档缩略图：合成一张「存档卡」，而不是对舞台做像素级截屏。
 *
 * 为什么是合成卡：WebView 没有跨端的截图 API（wry 未暴露 WebView2 的 CapturePreview，
 * WKWebView 的 takeSnapshot 也未接），宿主能拿到的只有 DOM，不是像素。合成卡把
 * 「背景 + 说话人 + 正文片段 + 时间戳」画进 canvas，确定性与可配性都更好，
 * 也不受舞台适配（缩放/裁切）影响。
 *
 * 尺寸/质量/是否带文本全部由工程清单的 `shell.saves.thumbnail` 决定（解析在
 * `resolveSavesConfig`），本模块只吃解析后的配置——宿主不自己读 JSON，避免
 * 「改工程配置却不生效」这类静默失败。
 *
 * 失败即降级：没有 canvas 2d 上下文（老 WebView / 内存紧张）时抛错，由调用方
 * 存一张**没有缩略图**的档——存档可用性优先于画面装饰。
 */

/** 合成卡参数：尺寸/质量/是否带文本来自 `shell.saves.thumbnail`，文本字段取当前对话。 */
export interface SaveThumbnailInput {
  width: number;
  height: number;
  quality: number;
  showText: boolean;
  /** 存档标题（缺省用工程名） */
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

/** 合成「存档卡」：背景渐变 + 说话人/正文片段 + 时间戳；无 canvas 上下文抛错。 */
export function captureSaveThumbnail(input: SaveThumbnailInput): string {
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("canvas 2d 上下文不可用");

  // 背景：纵向渐变，与舞台同色系（深色底，缩略图里不刺眼）
  const gradient = context.createLinearGradient(0, 0, 0, input.height);
  gradient.addColorStop(0, "#1e1e2e");
  gradient.addColorStop(1, "#12121a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, input.width, input.height);

  drawTextOverlay(context, input);

  return canvas.toDataURL("image/jpeg", input.quality);
}

/** 文字投影：标题 + 说话人 + 正文逐字符折行 + 时间戳 */
export function drawTextOverlay(
  context: CanvasRenderingContext2D,
  input: SaveThumbnailInput,
): void {
  if (!input.showText) return;
  const pad = Math.round(input.width * 0.06);

  context.fillStyle = "#7aa2f7";
  context.font = `bold ${Math.round(input.height * 0.09)}px sans-serif`;
  context.fillText(input.title ?? "", pad, Math.round(input.height * 0.22));

  const speakerY = Math.round(input.height * 0.46);
  if (input.speaker) {
    context.fillStyle = "#9ece6a";
    context.font = `${Math.round(input.height * 0.075)}px sans-serif`;
    context.fillText(input.speaker, pad, speakerY);
  }

  const line = (input.text ?? "").replace(/\s+/g, " ").trim();
  const maxWidth = input.width - pad * 2;
  const charSize = Math.round(input.height * 0.07);
  context.fillStyle = "#e6e6f0";
  context.font = `${charSize}px sans-serif`;
  // 逐字符折行：缩略图场景够用，CJK 也没有断词问题
  let cursorX = pad;
  let cursorY = speakerY + (input.speaker ? Math.round(charSize * 1.8) : 0);
  for (const char of line) {
    if (cursorX + charSize > maxWidth) {
      cursorX = pad;
      cursorY += Math.round(charSize * 1.4);
      if (cursorY > input.height - pad) break;
    }
    context.fillText(char, cursorX, cursorY);
    cursorX += charSize;
  }

  context.fillStyle = "#565f89";
  context.font = `${Math.round(input.height * 0.06)}px sans-serif`;
  context.fillText(
    new Date(input.timestamp).toLocaleString(),
    pad,
    input.height - Math.round(pad * 0.8),
  );
}

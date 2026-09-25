/**
 * ⑨-12 存档壳配置解析（宿主侧纯函数，05 §五 / 08 §八）：**默认 + 工程覆盖，不写死**。
 * 槽位数与缩略图参数都可被 project.json `shell.saves` 覆盖（逐键合并，非法忽略）——
 * 与 shell.orientation / shell.layers 同一解析纪律（信任边界：清单为 unknown）。
 */

export interface SavesThumbnailConfig {
  /** 缩略图宽（px） */
  width: number;
  /** 缩略图高（px） */
  height: number;
  /** JPEG 质量（0..1） */
  quality: number;
  /** 是否在缩略图上绘制文本（说话人/正文/时间戳） */
  showText: boolean;
}

export interface SavesConfig {
  /** 存档槽位数（slot_1..slot_N） */
  slots: number;
  thumbnail: SavesThumbnailConfig;
}

export const DEFAULT_SAVES_CONFIG: SavesConfig = {
  slots: 6,
  thumbnail: { width: 320, height: 180, quality: 0.7, showText: true },
};

function finiteInt(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function finiteIn01(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

/** 槽位 id 列表（与既有存储/Rust 侧命名兼容：slot_1..slot_N） */
export function slotIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `slot_${i + 1}`);
}

/** 解析存档壳配置：内建默认 × 工程覆盖（shell.saves，逐键合并；非法值/越界忽略） */
export function resolveSavesConfig(manifest: unknown): SavesConfig {
  const resolved: SavesConfig = {
    slots: DEFAULT_SAVES_CONFIG.slots,
    thumbnail: { ...DEFAULT_SAVES_CONFIG.thumbnail },
  };
  if (manifest === null || typeof manifest !== "object") return resolved;
  const shell = (manifest as { shell?: unknown }).shell;
  if (shell === null || typeof shell !== "object") return resolved;
  const saves = (shell as { saves?: unknown }).saves;
  if (saves === null || typeof saves !== "object") return resolved;
  const raw = saves as Record<string, unknown>;
  const slots = finiteInt(raw.slots, 1, 32);
  if (slots !== null) resolved.slots = slots;
  if (raw.thumbnail !== null && typeof raw.thumbnail === "object") {
    const t = raw.thumbnail as Record<string, unknown>;
    const width = finiteInt(t.width, 80, 1280);
    if (width !== null) resolved.thumbnail.width = width;
    const height = finiteInt(t.height, 45, 720);
    if (height !== null) resolved.thumbnail.height = height;
    const quality = finiteIn01(t.quality);
    if (quality !== null) resolved.thumbnail.quality = quality;
    if (typeof t.showText === "boolean") resolved.thumbnail.showText = t.showText;
  }
  return resolved;
}

/**
 * 壳配置解析（纯函数，宿主组合根装配用；契约见 contracts/shell.ts）。
 *
 * 与 `runtime/host.ts` 同域同纪律：**契约在 engine，解析也在 engine**——
 * 宿主（playground / 模板脚手架 / 未来宿主）一律 import 此处，
 * **禁止各自复制一份**（⑨-11/⑨-12 初期把它们放在 apps/playground/src/shell/，
 * 模板脚手架要接同一批能力时必然复制出第二真源——2026-09-26 收进引擎）。
 *
 * 统一纪律：清单入参一律 `unknown`（供给端口只保证「取到」，本地文件可被篡改/异版本），
 * 逐键合并工程覆盖 `project.json shell.*`，非法键/值一律忽略回默认（不猜、不抛）。
 */

import { isOrientationMode, SYS, type OrientationMode } from "../contracts";

/* ============================ ⑨-11 层级（z 序）============================ */

/** 舞台渲染层 id（与 08 §一 RenderTargets 及舞台 DOM 一一对应） */
export type LayerId =
  | "stage"
  | "video"
  | "dialogue"
  | "choices"
  | "minigame"
  | "notifications"
  | "toolbar"
  | "history"
  | "prefs";

export type LayerZTable = Record<LayerId, number>;
export type LayerZOverrides = Partial<Record<LayerId, number>>;

export const LAYER_IDS: readonly LayerId[] = [
  "stage",
  "video",
  "dialogue",
  "choices",
  "minigame",
  "notifications",
  "toolbar",
  "history",
  "prefs",
];

/**
 * 内建默认 z（语义化基线，间隔 100 便于工程插入自定义层）：
 * - `stage`(0)：舞台容器（背景 + 元素）——位于 video(100) 之下，元素间叠放在舞台内独立比较（§3.1 两级叠放）
 * - `video`(100)：过场视频——盖舞台，**不盖 say**（对话层在 video 等待期让位）
 * - `dialogue`(999)：say/对话层——内容层中最高
 * - `choices`(1100)：menu/input——对话层之上（等待期对话层已让位）
 * - `minigame`(1200)：整屏小游戏
 * - `notifications`(1300)：toast
 * - `toolbar`(1400) / `history`(1500) / `prefs`(1500)：常驻 HUD 与面板
 */
export const DEFAULT_LAYER_Z: LayerZTable = {
  stage: 0,
  video: 100,
  dialogue: 999,
  choices: 1100,
  minigame: 1200,
  notifications: 1300,
  toolbar: 1400,
  history: 1500,
  prefs: 1500,
};

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** 解析层 z 表：内建默认 × 工程覆盖（`shell.layers`，逐键合并；非法键/值忽略） */
export function resolveLayerZ(
  manifest: unknown,
  defaults: LayerZTable = DEFAULT_LAYER_Z,
): LayerZTable {
  const resolved: LayerZTable = { ...defaults };
  if (manifest !== null && typeof manifest === "object") {
    const shell = (manifest as { shell?: unknown }).shell;
    if (shell !== null && typeof shell === "object") {
      const layers = (shell as { layers?: unknown }).layers;
      if (layers !== null && typeof layers === "object") {
        for (const id of LAYER_IDS) {
          const value = (layers as Record<string, unknown>)[id];
          if (isFiniteNonNegative(value)) resolved[id] = value;
        }
      }
    }
  }
  return resolved;
}

/**
 * 单控件实例 z 解析（三级链）：**实例显式指定 > 工程层默认 > 内建默认**。
 * 规则对所有控件一律适用（say/video/元素系统 alike）——story/控件参数里的
 * `z`（如 say 2 z-index=20）经此收敛；未指定即回层默认。
 */
export function resolveInstanceZ(
  layer: LayerId,
  instanceZ: number | undefined,
  table: LayerZTable = DEFAULT_LAYER_Z,
): number {
  return isFiniteNonNegative(instanceZ) ? instanceZ : table[layer];
}

/**
 * 实例级 z 的 **SSOT 键 ↔ 渲染层** 映射（08 §八.3 的接线点，T01-03）。
 *
 * 仅「**拥有独立渲染层**」的命令参与：`say`→dialogue、`menu`/`input`→choices、
 * `notify`→notifications、`minigame`→minigame。
 * （舞台元素实例 z 走另一条路：`ElementInstance.z` = 元素 `zindex` > 到达序，舞台内部叠放。）
 *
 * 宿主用法（三行）：
 * ```ts
 * // 1) ValueChanged 里收纳：const layer = instanceZLayer(key); if (layer) zOverride[layer] = value;
 * // 2) 模板里解析：zIndex: resolveInstanceZ("dialogue", zOverride.dialogue, layerZ)
 * ```
 */
export const INSTANCE_Z_KEYS: Readonly<Partial<Record<LayerId, string>>> = {
  dialogue: SYS.dialogueZ,
  choices: SYS.choicesZ,
  notifications: SYS.notificationsZ,
  minigame: SYS.minigameZ,
};

/** 由 SSOT 键反查渲染层（宿主在 ValueChanged 中据此收纳实例 z；非实例 z 键 → undefined） */
export function instanceZLayer(key: string): LayerId | undefined {
  for (const [layer, instanceKey] of Object.entries(INSTANCE_Z_KEYS)) {
    if (instanceKey === key) return layer as LayerId;
  }
  return undefined;
}

/* ============================ ⑨-12 存档壳配置 ============================ */

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
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function finiteIn01(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

/** 槽位 id 列表（与既有存储/Rust 侧命名兼容：`slot_1..slot_N`） */
export function slotIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `slot_${i + 1}`);
}

/** 解析存档壳配置：内建默认 × 工程覆盖（`shell.saves`，逐键合并；非法值/越界忽略） */
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

/* ============================ ⑨-6 屏幕方向默认 ============================ */

/** 读工程默认方向（清单非法/缺声明 = undefined） */
export function manifestOrientation(
  manifest: unknown,
): OrientationMode | undefined {
  if (manifest === null || typeof manifest !== "object") return undefined;
  const shell = (manifest as { shell?: unknown }).shell;
  if (shell === null || typeof shell !== "object") return undefined;
  const orientation = (shell as { orientation?: unknown }).orientation;
  return isOrientationMode(orientation) ? orientation : undefined;
}

/**
 * 方向优先级链解析（组合根据此装配壳端口；纯函数可测）：
 * **玩家显式偏好 > 工程默认 > auto**——玩家显式选 auto（跟随系统）优先于作者默认。
 */
export function resolveOrientationMode(
  preference: OrientationMode | undefined,
  manifestDefault: OrientationMode | undefined,
): OrientationMode {
  return preference ?? manifestDefault ?? "auto";
}
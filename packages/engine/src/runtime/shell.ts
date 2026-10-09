/**
 * 壳配置解析（纯函数，宿主组合根装配用；契约见 contracts/shell.ts）。
 *
 * 与 `runtime/host.ts` 同域同一处理：**契约在 engine，解析也在 engine**——
 * 宿主（playground / 模板脚手架 / 其它宿主）一律 import 此处，
 * **不各自复制一份**（各宿主重复实现会产出多套口径）。
 *
 * 统一口径：清单入参一律 `unknown`（供给端口只保证「取到」，本地文件可被篡改/异版本），
 * 逐键合并工程覆盖 `project.json shell.*`，非法键/值一律忽略回默认（不猜、不抛）。
 */

import {
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  isOrientationMode,
  LAYER_IDS,
  SYS,
  type LayerId,
  type LayerZTable,
  type OrientationMode,
  type SavesConfig,
} from "../contracts";

/**
 * 层级与存档壳的契约类型定义在契约层（`contracts/shell.ts`），
 * 此处按原路径转出，既有消费方无需改动即可继续从本模块取；
 * 收口时统一改走包出口。
 */
export {
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  LAYER_IDS,
} from "../contracts";
export type {
  LayerId,
  LayerZOverrides,
  LayerZTable,
  SavesConfig,
  SavesThumbnailConfig,
} from "../contracts";

/* ============================ 层级（z 序）============================ */

/** z 序取值判据：有限且不小于 0 的 number 才采纳，否则回落到默认层 z */
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
 * 实例级 z 的 **SSOT 键 ↔ 渲染层** 映射（实例级 z 的接线点）。
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
  video: SYS.videoZ,
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

/* ============================ 存档壳配置 ============================ */

/** 取 [min,max] 闭区间内的整数；不是整数或越界一律返回 null，由调用方保持默认 */
function finiteInt(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** 取 0..1 之间的有限数（比例类参数）；越界或非有限一律 null */
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

/* ============================ 屏幕方向默认 ============================ */

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
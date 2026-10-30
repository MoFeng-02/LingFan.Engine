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
  AUDIO_CHANNELS,
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  DEFAULT_STAGE_CONFIG,
  isOrientationMode,
  LAYER_IDS,
  SYS,
  type AudioChannel,
  type AudioConfig,
  type LayerId,
  type LayerZTable,
  type OrientationMode,
  type SavesConfig,
  type StageAlign,
  type StageConfig,
  type StageFit,
  type StageScalePolicy,
} from "../contracts/index.ts";

/**
 * 层级与存档壳的契约类型定义在契约层（`contracts/shell.ts`），
 * 此处按原路径转出，既有消费方无需改动即可继续从本模块取；
 * 后续并入包出口时统一改走包出口。
 */
export {
  DEFAULT_AUDIO_CONFIG,
  DEFAULT_LAYER_Z,
  DEFAULT_SAVES_CONFIG,
  DEFAULT_STAGE_CONFIG,
  LAYER_IDS,
} from "../contracts/index.ts";
export type {
  AudioConfig,
  LayerId,
  LayerZOverrides,
  LayerZTable,
  SavesConfig,
  SavesThumbnailConfig,
  StageAlign,
  StageConfig,
  StageFit,
  StageScalePolicy,
} from "../contracts/index.ts";

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

/** 取清单里一个非空字符串字段；不是字符串或是空串一律返回 null，由调用方决定回落 */
function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 解析工程展示名：`name` → `id` → 空串。
 *
 * 展示名是**给玩家看的**那一行字，与工程 id 是两个用途：id 是存储与引用目标（不可随意改），
 * name 才是可随时换的招牌。缺 name 时退回 id 是为了让工程至少有个名字可显示；
 * 两者都没有才算没名字（空串），由调用方决定怎么兜。
 *
 * 入参与其他壳配置解析同口径：`unknown`、不猜不抛——清单是外部文件，畸形是常态不是异常。
 */
export function resolveProjectName(manifest: unknown): string {
  if (manifest === null || typeof manifest !== "object") return "";
  const record = manifest as Record<string, unknown>;
  return nonEmptyText(record.name) ?? nonEmptyText(record.id) ?? "";
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
    if (typeof t.showText === "boolean")
      resolved.thumbnail.showText = t.showText;
  }
  return resolved;
}

/* ============================ 音频壳配置 ============================ */

/** 通道音量：有限数按物理范围钳制；其余（含缺键）回 null，由调用方保持默认 */
function channelVolume(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * 解析音频壳配置：内建默认（四通道皆 1）× 工程覆盖（`shell.audio.volumes`）。
 *
 * 与 `resolveSavesConfig` 同一口径（清单入参 `unknown`、不猜不抛），差别在越界处理：
 * 越界值**钳制后采纳**（`1.5` ⇒ `1`）而不是丢弃——与命令面 `volume=` 的行为一致，
 * 作者手滑写个越界数不该让音量悄悄回满。非有限数（`NaN`/`Infinity`/字符串）仍忽略，
 * 它们不是「差一点」而是「不是数」。
 *
 * 真正的畸形在组装期就 fail-closed 了（`project.json: shell.audio.volumes.<通道>
 * 必须为 0..1 的有限数字`），这里的宽松只是不让解析函数自己抛。
 */
export function resolveAudioConfig(
  manifest: unknown,
  defaults: AudioConfig = DEFAULT_AUDIO_CONFIG,
): AudioConfig {
  const resolved: Record<AudioChannel, number> = { ...defaults.volumes };
  if (manifest === null || typeof manifest !== "object") {
    return { volumes: resolved };
  }
  const shell = (manifest as { shell?: unknown }).shell;
  if (shell === null || typeof shell !== "object") return { volumes: resolved };
  const audio = (shell as { audio?: unknown }).audio;
  if (audio === null || typeof audio !== "object") return { volumes: resolved };
  const volumes = (audio as { volumes?: unknown }).volumes;
  if (volumes === null || typeof volumes !== "object") {
    return { volumes: resolved };
  }
  for (const channel of AUDIO_CHANNELS) {
    const value = channelVolume((volumes as Record<string, unknown>)[channel]);
    if (value !== null) resolved[channel] = value;
  }
  return { volumes: resolved };
}

/* ============================ 舞台适配配置 ============================ */

/** 取 [min,max] 闭区间内的有限数（尺寸/倍率允许小数）；越界或非有限一律 null */
function finiteInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** 内置策略名（与 `@lingfan-engine/shell` 预设表的键一致） */
const STAGE_FITS: readonly StageFit[] = ["contain", "cover", "fill", "none"];
/** 显式缩放策略名（数字倍率另走有限数校验） */
const STAGE_SCALE_POLICIES: readonly StageScalePolicy[] = [
  "min",
  "max",
  "width",
  "height",
  "fill",
];
/** 对齐锚点 */
const STAGE_ALIGNS: readonly StageAlign[] = ["start", "center", "end"];

function isStageFit(value: unknown): value is StageFit {
  return STAGE_FITS.includes(value as StageFit);
}

function isStageAlign(value: unknown): value is StageAlign {
  return STAGE_ALIGNS.includes(value as StageAlign);
}

/** 倍率类参数（`scaleBy` 数字 / `minScale` / `maxScale`）的可接受区间 */
const STAGE_SCALE_MIN = 0.05;
const STAGE_SCALE_MAX = 64;
/** 基准尺寸的可接受区间：能摆下一个面板、又不至于大到无意义的坐标系 */
const STAGE_WIDTH_RANGE = { min: 160, max: 16384 } as const;
const STAGE_HEIGHT_RANGE = { min: 90, max: 16384 } as const;

/** 缩放策略：名字或有限正倍率（倍率范围同 minScale/maxScale）；其余一律 null */
function stageScalePolicy(value: unknown): StageScalePolicy | null {
  if (STAGE_SCALE_POLICIES.includes(value as StageScalePolicy)) {
    return value as StageScalePolicy;
  }
  return finiteInRange(value, STAGE_SCALE_MIN, STAGE_SCALE_MAX);
}

/**
 * 解析舞台适配配置：内建默认 × 工程覆盖（`shell.stage`，逐键合并；非法值忽略）。
 *
 * 与 `resolveSavesConfig` 同一口径（清单入参 `unknown`、不猜不抛），另有两条舞台专有规则：
 * - 基准宽高与倍率必须落在可接受区间内（坐标系大小直接决定整场缩放，越界值比缺省更坏）；
 * - `minScale > maxScale` 时**两条一起弃用**（保留默认的「不夹取」）——只留一条会得到
 *   一个必然夹死或永不生效的区间，不如当作没声明。
 */
export function resolveStageConfig(
  manifest: unknown,
  defaults: StageConfig = DEFAULT_STAGE_CONFIG,
): StageConfig {
  // 契约字段是 readonly（给消费方的约束），解析期要逐键落值，故先摊成可写视图
  const resolved: { -readonly [K in keyof StageConfig]: StageConfig[K] } = {
    ...defaults,
  };
  if (manifest === null || typeof manifest !== "object") return resolved;
  const shell = (manifest as { shell?: unknown }).shell;
  if (shell === null || typeof shell !== "object") return resolved;
  const raw = (shell as { stage?: unknown }).stage;
  if (raw === null || typeof raw !== "object") return resolved;
  const stage = raw as Record<string, unknown>;

  const width = finiteInRange(
    stage.width,
    STAGE_WIDTH_RANGE.min,
    STAGE_WIDTH_RANGE.max,
  );
  if (width !== null) resolved.width = width;
  const height = finiteInRange(
    stage.height,
    STAGE_HEIGHT_RANGE.min,
    STAGE_HEIGHT_RANGE.max,
  );
  if (height !== null) resolved.height = height;
  if (isStageFit(stage.fit)) resolved.fit = stage.fit;
  const scaleBy = stageScalePolicy(stage.scaleBy);
  if (scaleBy !== null) resolved.scaleBy = scaleBy;
  if (isStageAlign(stage.alignX)) resolved.alignX = stage.alignX;
  if (isStageAlign(stage.alignY)) resolved.alignY = stage.alignY;
  const minScale = finiteInRange(
    stage.minScale,
    STAGE_SCALE_MIN,
    STAGE_SCALE_MAX,
  );
  const maxScale = finiteInRange(
    stage.maxScale,
    STAGE_SCALE_MIN,
    STAGE_SCALE_MAX,
  );
  if (minScale !== null && maxScale !== null && minScale > maxScale) {
    return resolved;
  }
  if (minScale !== null) resolved.minScale = minScale;
  if (maxScale !== null) resolved.maxScale = maxScale;
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

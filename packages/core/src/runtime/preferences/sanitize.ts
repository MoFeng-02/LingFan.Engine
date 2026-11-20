/**
 * 玩家偏好载荷的信任边界（逐字段校验降级）：载荷可能来自被篡改的本地文件或异版本
 * 存档，非法字段一律回落「未设置」或默认值，绝不把畸形值翻译成运行时状态。
 *
 * 核心纪律——**缺省 ≠ 显式**：可选字段缺席表示「跟随」（系统/作者/内建），
 * 校验只在该键给了合法值时才写入；非法值丢弃该键而不是补默认，
 * 否则会把「玩家没说过」篡改成「玩家显式说过」，改变优先级链的走向。
 */
import type {
  AudioChannel,
  DialoguePosition,
  ElementFit,
  PlayerKeymap,
  PlayerPrefsData,
  WindowSize,
} from "../../contracts/index.ts";
import {
  AUTO_DELAY_MS_RANGE,
  DEFAULT_PLAYER_PREFS,
  DIALOGUE_HEIGHT_SCALE_RANGE,
  DIALOGUE_POSITIONS,
  ELEMENT_FITS,
  FONT_FAMILY_MAX,
  FONT_SCALE_RANGE,
  KEYMAP_ACTIONS,
  LANGUAGE_MAX,
  NVL_PAGE_SIZE_RANGE,
  SKIP_DELAY_MS_RANGE,
  TRANSITION_SPEED_RANGE,
  WINDOW_HEIGHT_RANGE,
  WINDOW_WIDTH_RANGE,
} from "../../contracts/index.ts";
import { clamp01, isOrientationMode } from "../../shared/index.ts";

/** 音量通道全集（bgm / se / ambient / voice） */
const CHANNELS: readonly AudioChannel[] = ["bgm", "se", "ambient", "voice"];

/** 单键名上限（KeyboardEvent.key 字面量，含命名键如 Enter/ArrowLeft） */
const KEY_NAME_MAX = 32;
/** 单动作键位条数上限（防畸形载荷撑爆列表） */
const KEYMAP_ENTRIES_MAX = 8;

/** 浮点倍率校验：有限数钳到 [min,max]，非有限数丢弃（返回 undefined = 未设置） */
function sanitizeFloat(
  raw: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.min(max, Math.max(min, raw));
}

/** 整数计数校验：整数钳到 [min,max]，非整数/非有限数丢弃 */
function sanitizeInt(
  raw: unknown,
  min: number,
  max: number,
): number | undefined {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return undefined;
  return Math.min(max, Math.max(min, raw));
}

/** 布尔校验：仅真布尔采纳，其余丢弃（缺省由消费点解释） */
function sanitizeBoolean(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

/** 闭合词表校验：成员才采纳，其余丢弃 */
function sanitizeEnum<T extends string>(
  raw: unknown,
  values: readonly T[],
): T | undefined {
  return typeof raw === "string" && (values as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}

/** 窗口尺寸校验：宽高都必须是值域内整数，任一非法整体丢弃（不部分采纳） */
function sanitizeWindowSize(raw: unknown): WindowSize | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const { width, height } = source;
  const widthOk =
    typeof width === "number" &&
    Number.isInteger(width) &&
    width >= WINDOW_WIDTH_RANGE.min &&
    width <= WINDOW_WIDTH_RANGE.max;
  const heightOk =
    typeof height === "number" &&
    Number.isInteger(height) &&
    height >= WINDOW_HEIGHT_RANGE.min &&
    height <= WINDOW_HEIGHT_RANGE.max;
  if (!widthOk || !heightOk) return undefined;
  return { width: width as number, height: height as number };
}

/**
 * 键位覆盖逐项校验（信任边界）：非字符串/空白/超长条目丢弃，大小写不敏感去重，
 * 条数封顶；单动作清空 = 该动作回落内建默认（不进载荷）。
 */
export function sanitizeKeymap(raw: unknown): PlayerKeymap | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const out: PlayerKeymap = {};
  for (const action of KEYMAP_ACTIONS) {
    const entries = source[action];
    if (!Array.isArray(entries)) continue;
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const entry of entries) {
      if (typeof entry !== "string") continue;
      const key = entry.trim();
      if (key.length === 0 || key.length > KEY_NAME_MAX) continue;
      const dedupeId = key.toLowerCase();
      if (seen.has(dedupeId)) continue;
      seen.add(dedupeId);
      keys.push(key);
      if (keys.length >= KEYMAP_ENTRIES_MAX) break;
    }
    if (keys.length > 0) out[action] = keys;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 载荷逐字段校验降级（信任边界）：基础键恒在（回落默认），可选键仅合法才写入。
 * 非法的可选值 = 该键不存在（跟随缺省），绝不补默认键——缺省与显式是两种意图。
 */
export function sanitize(raw: unknown): PlayerPrefsData {
  const data: PlayerPrefsData = {
    v: 1,
    volumes: { ...DEFAULT_PLAYER_PREFS.volumes },
    muted: DEFAULT_PLAYER_PREFS.muted,
    textSpeed: DEFAULT_PLAYER_PREFS.textSpeed,
  };
  if (raw === null || typeof raw !== "object") return data;
  const source = raw as Partial<PlayerPrefsData>;
  if (source.volumes !== null && typeof source.volumes === "object") {
    const volumes = source.volumes as Record<string, unknown>;
    for (const channel of CHANNELS) {
      const value = volumes[channel];
      if (typeof value === "number" && Number.isFinite(value)) {
        data.volumes[channel] = clamp01(value);
      }
    }
  }
  if (typeof source.muted === "boolean") data.muted = source.muted;
  if (
    typeof source.textSpeed === "number" &&
    Number.isFinite(source.textSpeed)
  ) {
    data.textSpeed = Math.max(1, source.textSpeed);
  }
  // 字速归属：只认两个显式取值；非法/缺席都保持键不存在——缺省（玩家覆盖故事）
  // 与显式声明是两种意图，补默认键会把「没说过」篡改成「说过」
  if (
    source.textSpeedSource === "story" ||
    source.textSpeedSource === "player"
  ) {
    data.textSpeedSource = source.textSpeedSource;
  }
  // 方向偏好：合法三态才采纳；非法值 = 未设置（跟随工程默认，绝不翻译成非法方向）
  if (isOrientationMode(source.orientation))
    data.orientation = source.orientation;
  // 键位覆盖：逐项降级；全部无效 = 无覆盖（动作走内建默认键位）
  const keymap = sanitizeKeymap(source.keymap);
  if (keymap !== undefined) data.keymap = keymap;
  // 全屏偏好：仅布尔采纳；非布尔 = 未设置（窗口化默认）
  if (typeof source.fullscreen === "boolean")
    data.fullscreen = source.fullscreen;

  // 主音量：0..1 倍率，缺省 = 1（消费点解释）
  const masterVolume = sanitizeFloat(source.masterVolume, 0, 1);
  if (masterVolume !== undefined) data.masterVolume = masterVolume;
  // 即时文本 / 自动 / 快进 / 打字音效：布尔开关（自动/快进消费归相应功能批）
  const instantText = sanitizeBoolean(source.instantText);
  if (instantText !== undefined) data.instantText = instantText;
  const autoEnabled = sanitizeBoolean(source.autoEnabled);
  if (autoEnabled !== undefined) data.autoEnabled = autoEnabled;
  const skipUnseenOnly = sanitizeBoolean(source.skipUnseenOnly);
  if (skipUnseenOnly !== undefined) data.skipUnseenOnly = skipUnseenOnly;
  const typeSound = sanitizeBoolean(source.typeSound);
  if (typeSound !== undefined) data.typeSound = typeSound;
  // 自动/快进停留时长：非负整数毫秒，钳到各自上限
  const autoDelayMs = sanitizeInt(
    source.autoDelayMs,
    AUTO_DELAY_MS_RANGE.min,
    AUTO_DELAY_MS_RANGE.max,
  );
  if (autoDelayMs !== undefined) data.autoDelayMs = autoDelayMs;
  const skipDelayMs = sanitizeInt(
    source.skipDelayMs,
    SKIP_DELAY_MS_RANGE.min,
    SKIP_DELAY_MS_RANGE.max,
  );
  if (skipDelayMs !== undefined) data.skipDelayMs = skipDelayMs;

  // 转场/抖动/字号/对话框外观倍率：各自值域钳制
  const transitionSpeed = sanitizeFloat(
    source.transitionSpeed,
    TRANSITION_SPEED_RANGE.min,
    TRANSITION_SPEED_RANGE.max,
  );
  if (transitionSpeed !== undefined) data.transitionSpeed = transitionSpeed;
  const shakeScale = sanitizeFloat(source.shakeScale, 0, 1);
  if (shakeScale !== undefined) data.shakeScale = shakeScale;
  const fontScale = sanitizeFloat(
    source.fontScale,
    FONT_SCALE_RANGE.min,
    FONT_SCALE_RANGE.max,
  );
  if (fontScale !== undefined) data.fontScale = fontScale;
  const dialogueOpacity = sanitizeFloat(source.dialogueOpacity, 0, 1);
  if (dialogueOpacity !== undefined) data.dialogueOpacity = dialogueOpacity;
  const dialogueHeightScale = sanitizeFloat(
    source.dialogueHeightScale,
    DIALOGUE_HEIGHT_SCALE_RANGE.min,
    DIALOGUE_HEIGHT_SCALE_RANGE.max,
  );
  if (dialogueHeightScale !== undefined)
    data.dialogueHeightScale = dialogueHeightScale;
  // 减弱动效：三态（缺省跟随系统），仅布尔采纳、不补默认键
  const reducedMotion = sanitizeBoolean(source.reducedMotion);
  if (reducedMotion !== undefined) data.reducedMotion = reducedMotion;
  // 对话框位置：闭合词表
  const dialoguePosition = sanitizeEnum<DialoguePosition>(
    source.dialoguePosition,
    DIALOGUE_POSITIONS,
  );
  if (dialoguePosition !== undefined) data.dialoguePosition = dialoguePosition;
  // 默认字体：非空字符串限长（可用性由宿主装配期按注册表校验）
  if (
    typeof source.fontFamily === "string" &&
    source.fontFamily.length > 0 &&
    source.fontFamily.length <= FONT_FAMILY_MAX
  ) {
    data.fontFamily = source.fontFamily;
  }
  // NVL 每页行数：正整数钳到上限（缺省 = 不分页）
  const nvlPageSize = sanitizeInt(
    source.nvlPageSize,
    NVL_PAGE_SIZE_RANGE.min,
    NVL_PAGE_SIZE_RANGE.max,
  );
  if (nvlPageSize !== undefined) data.nvlPageSize = nvlPageSize;
  // 元素填充默认槽：闭合五词（缺省 = 内建 cover，op 显式优先）
  const elementFit = sanitizeEnum<ElementFit>(source.elementFit, ELEMENT_FITS);
  if (elementFit !== undefined) data.elementFit = elementFit;
  // 窗口尺寸：宽高均合法才整体采纳
  const windowSize = sanitizeWindowSize(source.windowSize);
  if (windowSize !== undefined) data.windowSize = windowSize;
  // 语言：非空字符串限长（缺省 = 不干预；读档存档语言赢）
  if (
    typeof source.language === "string" &&
    source.language.length > 0 &&
    source.language.length <= LANGUAGE_MAX
  ) {
    data.language = source.language;
  }
  return data;
}

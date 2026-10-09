/**
 * 玩家偏好（核心层纯 TS 状态，可测）：与存档分离——不进引擎
 * SSOT/快照/存档（回溯与读档不得改变玩家设置），经 PreferencesPort 独立持久化。
 * 音量合成末端 = effectiveVolume（静音归零；op 音量 × 通道偏好在渲染层进行——
 * 合成末端语义）。持久化防抖（trailing）合并滑块连写，
 * dispose 补尾防丢末次修改（与防抖同一处理）。
 */
import type {
  AudioChannel,
  KeymapAction,
  OrientationMode,
  PlayerKeymap,
  PlayerPrefsData,
  PreferencesPort,
} from "../contracts";
import {
  DEFAULT_PLAYER_PREFS,
  KEYMAP_ACTIONS,
  isOrientationMode,
} from "../contracts";
import { clamp01 } from "../shared";

/** 偏好变更回调；收到的是快照副本，调用方改写它不会穿透到内部状态 */
type PrefsListener = (data: PlayerPrefsData) => void;

/** 音量通道全集（bgm / se / ambient / voice） */
const CHANNELS: readonly AudioChannel[] = ["bgm", "se", "ambient", "voice"];

/** 持久化防抖静默窗：滑块拖动连发 set 合并为一次落盘 */
const PERSIST_DEBOUNCE_MS = 300;

/** 单键名上限（KeyboardEvent.key 字面量，含命名键如 Enter/ArrowLeft） */
const KEY_NAME_MAX = 32;
/** 单动作键位条数上限（防畸形载荷撑爆列表） */
const KEYMAP_ENTRIES_MAX = 8;

/**
 * 键位覆盖逐项校验（信任边界）：非字符串/空白/超长条目丢弃，大小写不敏感去重，
 * 条数封顶；单动作清空 = 该动作回落内建默认（不进载荷）。
 */
function sanitizeKeymap(raw: unknown): PlayerKeymap | undefined {
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
 * 载荷逐字段校验降级（信任边界：可能来自被篡改的本地文件/异版本载荷）——
 * 非法字段回落默认值，绝不把畸形值翻译成运行时状态（readAudioView 同风格）。
 */
function sanitize(raw: unknown): PlayerPrefsData {
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
  // 方向偏好：合法三态才采纳；非法值 = 未设置（跟随工程默认，绝不翻译成非法方向）
  if (isOrientationMode(source.orientation)) data.orientation = source.orientation;
  // 键位覆盖：逐项降级；全部无效 = 无覆盖（动作走内建默认键位）
  const keymap = sanitizeKeymap(source.keymap);
  if (keymap !== undefined) data.keymap = keymap;
  // 全屏偏好：仅布尔采纳；非布尔 = 未设置（窗口化默认）
  if (typeof source.fullscreen === "boolean") data.fullscreen = source.fullscreen;
  return data;
}

/**
 * 玩家偏好状态机（纯 TS，可测）：只读访问器供 UI/渲染层取用。
 * 除启动期 hydrate 直接写入真值再广播（不落盘）外，所有写入都收口到 update（换真值 → 广播快照 → 防抖落盘）；
 * 故事读档/回溯不经过这里，所以玩家设置在整局里保持稳定。
 */
export class PlayerPreferences {
  /** 当前偏好真值；由 sanitize 产出，可选字段缺失表示「未设置」而不是默认值 */
  private data: PlayerPrefsData;
  /** 变更订阅者；Set 保证同一监听器重复注册也只收到一次回调 */
  private readonly listeners = new Set<PrefsListener>();
  /** 防抖计时器句柄，非 null 表示还有一次落盘待补发 */
  private pendingSave: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param port 持久化端口；缺省 = 纯内存模式（不落盘，hydrate/dispose 均为空操作）
   */
  constructor(private readonly port?: PreferencesPort) {
    this.data = sanitize(undefined);
  }

  /** 只读快照（新引用——UI 可安全持有做响应式镜像）；可选字段缺省 = 键不存在 */
  snapshot(): PlayerPrefsData {
    const snap: PlayerPrefsData = {
      v: 1,
      volumes: { ...this.data.volumes },
      muted: this.data.muted,
      textSpeed: this.data.textSpeed,
    };
    if (this.data.orientation !== undefined) {
      snap.orientation = this.data.orientation;
    }
    if (this.data.keymap !== undefined) {
      // 新数组引用（嵌套隔离——UI 改写不得穿透偏好状态）
      const keymap: PlayerKeymap = {};
      if (this.data.keymap.advance !== undefined) {
        keymap.advance = [...this.data.keymap.advance];
      }
      if (this.data.keymap.history !== undefined) {
        keymap.history = [...this.data.keymap.history];
      }
      snap.keymap = keymap;
    }
    if (this.data.fullscreen !== undefined) {
      snap.fullscreen = this.data.fullscreen;
    }
    return snap;
  }

  /** 是否静音；为 true 时 effectiveVolume 一律归零，但各通道音量偏好照旧保留 */
  get muted(): boolean {
    return this.data.muted;
  }

  /** 文本显示速度（单位口径由渲染层解释）；下限 1，非法写入被忽略 */
  get textSpeed(): number {
    return this.data.textSpeed;
  }

  /** 方向偏好（undefined = 未设置，跟随工程默认/auto；壳应用由组合根负责） */
  get orientation(): OrientationMode | undefined {
    return this.data.orientation;
  }

  /** 指定通道的偏好音量（0..1，未经静音合成）；从未设置过该通道时回默认值 */
  volume(channel: AudioChannel): number {
    return this.data.volumes[channel];
  }

  /** 有效音量（合成末端）：静音归零，否则通道偏好 0..1 */
  effectiveVolume(channel: AudioChannel): number {
    if (this.data.muted) return 0;
    return this.data.volumes[channel];
  }

  /** 设置单通道音量：非有限数忽略，其余钳到 0..1（fail-closed，不抛出） */
  setVolume(channel: AudioChannel, value: number): void {
    if (typeof value !== "number" || !Number.isFinite(value)) return; // 畸形值忽略（fail-closed）
    this.update({
      ...this.data,
      volumes: { ...this.data.volumes, [channel]: clamp01(value) },
    });
  }

  /** 设置静音（非布尔忽略）；只改合成末端，不改写任何通道的音量偏好 */
  setMuted(muted: boolean): void {
    if (typeof muted !== "boolean") return;
    this.update({ ...this.data, muted });
  }

  /** 设置文本速度：非有限数忽略，起点夹到 1（0 或负数会让打字机永远推不完） */
  setTextSpeed(value: number): void {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    this.update({ ...this.data, textSpeed: Math.max(1, value) });
  }

  /** 设置方向偏好（非法模式忽略——fail-closed；应用归组合根订阅者） */
  setOrientation(mode: OrientationMode): void {
    if (!isOrientationMode(mode)) return;
    if (this.data.orientation === mode) return;
    this.update({ ...this.data, orientation: mode });
  }

  /** 清除方向偏好 = 回到「跟随工程默认」（面板「跟随工程」项） */
  clearOrientation(): void {
    if (this.data.orientation === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.orientation;
    this.update(next);
  }

  /** 键位覆盖视图（undefined = 该域无覆盖，动作走内建默认键位） */
  get keymap(): PlayerKeymap | undefined {
    return this.data.keymap;
  }

  /** 单动作键位覆盖（undefined = 内建默认；宿主匹配时大小写不敏感） */
  keybinding(action: KeymapAction): string[] | undefined {
    return this.data.keymap?.[action];
  }

  /**
   * 设置单动作键位覆盖（信任边界：逐项校验同 sanitizeKeymap；
   * 校验后为空 = 清除该动作覆盖即回内建默认）。
   */
  setKeybinding(action: KeymapAction, keys: readonly unknown[]): void {
    const sanitized = sanitizeKeymap({ [action]: keys })?.[action];
    if (sanitized === undefined) {
      this.clearKeybinding(action);
      return;
    }
    const base: PlayerKeymap =
      this.data.keymap !== undefined
        ? { advance: this.data.keymap.advance, history: this.data.keymap.history }
        : {};
    const next: PlayerKeymap = { ...base, [action]: sanitized };
    this.update({ ...this.data, keymap: next });
  }

  /** 清除单动作键位覆盖 = 该动作回内建默认；无任何覆盖后整个 keymap 键移除 */
  clearKeybinding(action: KeymapAction): void {
    if (this.data.keymap?.[action] === undefined) return;
    const next: PlayerKeymap = { ...this.data.keymap };
    delete next[action];
    const data: PlayerPrefsData = { ...this.data, keymap: next };
    if (Object.keys(next).length === 0) delete data.keymap;
    this.update(data);
  }

  /** 全屏偏好（undefined = 未设置 = 窗口化默认；宿主应用尽力而为） */
  get fullscreen(): boolean | undefined {
    return this.data.fullscreen;
  }

  /** 设置全屏偏好（非布尔忽略）；窗口是否真的全屏由宿主尽力而为 */
  setFullscreen(on: boolean): void {
    if (typeof on !== "boolean") return;
    this.update({ ...this.data, fullscreen: on });
  }

  /** 订阅偏好变化（UI 响应式镜像/渲染层重规划）；返回退订函数 */
  onChange(listener: PrefsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 载入持久化偏好（组合根 boot 时调用一次）：合法字段应用、非法字段降级默认；
   * 端口缺失或载入失败 = 使用默认值起航（不影响启动，诊断归端口实现/组合根）。
   */
  async hydrate(): Promise<void> {
    if (this.port === undefined) return;
    let raw: unknown;
    try {
      raw = await this.port.load();
    } catch {
      return;
    }
    if (raw !== null) this.data = sanitize(raw);
    this.emit();
  }

  /** 会话收尾：补发未落盘的末次修改（防抖尾结算） */
  dispose(): void {
    if (this.pendingSave === null || this.port === undefined) return;
    clearTimeout(this.pendingSave);
    this.pendingSave = null;
    void this.port.save(this.snapshot()).catch(() => {}); // 持久化失败不影响运行时
  }

  /** 唯一写入口：先落真值，再广播快照，最后安排落盘（顺序固定，订阅者看到的是新值） */
  private update(next: PlayerPrefsData): void {
    this.data = next;
    this.emit();
    this.scheduleSave();
  }

  /**
   * 把同一份快照依次推给所有订阅者（同一引用，订阅者不应依赖它随后的变化）。
   * 某个订阅者抛错会中断本次通知并向上冒泡，故监听器应当自己吞掉可预期的异常。
   */
  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  /** 防抖落盘：静默窗内的连续写入只落最后一次；无端口时跳过；落盘失败被吞掉 */
  private scheduleSave(): void {
    if (this.port === undefined) return;
    if (this.pendingSave !== null) clearTimeout(this.pendingSave);
    this.pendingSave = setTimeout(() => {
      this.pendingSave = null;
      void this.port?.save(this.snapshot()).catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
  }
}

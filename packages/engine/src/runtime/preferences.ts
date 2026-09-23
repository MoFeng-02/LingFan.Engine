/**
 * 08 §八.2 / U10 玩家偏好（核心层纯 TS 状态，可测）：与存档分离——不进引擎
 * SSOT/快照/存档（回溯与读档不得改变玩家设置），经 PreferencesPort 独立持久化。
 * 音量合成末端 = effectiveVolume（静音归零；op 音量 × 通道偏好在渲染层进行——
 * 老引擎 GetEffectiveVolume 同语义）。持久化防抖（trailing）合并滑块连写，
 * dispose 补尾防丢末次修改（热重载防抖同教训）。
 */
import type {
  AudioChannel,
  PlayerPrefsData,
  PreferencesPort,
} from "../contracts";
import { DEFAULT_PLAYER_PREFS } from "../contracts";

type PrefsListener = (data: PlayerPrefsData) => void;

const CHANNELS: readonly AudioChannel[] = ["bgm", "se", "ambient", "voice"];

/** 持久化防抖静默窗：滑块拖动连发 set 合并为一次落盘 */
const PERSIST_DEBOUNCE_MS = 300;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
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
  return data;
}

export class PlayerPreferences {
  private data: PlayerPrefsData;
  private readonly listeners = new Set<PrefsListener>();
  private pendingSave: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly port?: PreferencesPort) {
    this.data = sanitize(undefined);
  }

  /** 只读快照（新引用——UI 可安全持有做响应式镜像） */
  snapshot(): PlayerPrefsData {
    return {
      v: 1,
      volumes: { ...this.data.volumes },
      muted: this.data.muted,
      textSpeed: this.data.textSpeed,
    };
  }

  get muted(): boolean {
    return this.data.muted;
  }

  get textSpeed(): number {
    return this.data.textSpeed;
  }

  volume(channel: AudioChannel): number {
    return this.data.volumes[channel];
  }

  /** 08 §八.2 有效音量（合成末端）：静音归零，否则通道偏好 0..1 */
  effectiveVolume(channel: AudioChannel): number {
    if (this.data.muted) return 0;
    return this.data.volumes[channel];
  }

  setVolume(channel: AudioChannel, value: number): void {
    if (typeof value !== "number" || !Number.isFinite(value)) return; // 畸形值忽略（fail-closed）
    this.update({
      ...this.data,
      volumes: { ...this.data.volumes, [channel]: clamp01(value) },
    });
  }

  setMuted(muted: boolean): void {
    if (typeof muted !== "boolean") return;
    this.update({ ...this.data, muted });
  }

  setTextSpeed(value: number): void {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    this.update({ ...this.data, textSpeed: Math.max(1, value) });
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
   * 端口缺失或载入失败 = 使用默认值起航（不炸启动，诊断归端口实现/组合根）。
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
    void this.port.save(this.snapshot()).catch(() => {}); // 持久化失败不炸运行时
  }

  private update(next: PlayerPrefsData): void {
    this.data = next;
    this.emit();
    this.scheduleSave();
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  private scheduleSave(): void {
    if (this.port === undefined) return;
    if (this.pendingSave !== null) clearTimeout(this.pendingSave);
    this.pendingSave = setTimeout(() => {
      this.pendingSave = null;
      void this.port?.save(this.snapshot()).catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
  }
}

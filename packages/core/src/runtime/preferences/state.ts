/**
 * 玩家偏好状态机（纯 TS，可测）：只读访问器供 UI/渲染层取用。
 * 除启动期 hydrate 直接写入真值再广播（不落盘）外，所有写入都经由 update
 * （换真值 → 广播快照 → 防抖落盘）；故事读档/回溯不经过这里，玩家设置整局稳定。
 *
 * 可选字段「缺省 ≠ 显式」：getter 返回 undefined 表示未设置（跟随系统/作者/内建），
 * 消费点据此走优先级链；clear* 把字段退回缺省。数值/布尔倍率字段的 getter 直接
 * 解析出内建默认（缺省 = 内建），三态字段保留 undefined 信号。
 */
import type {
  AudioChannel,
  DialoguePosition,
  ElementFit,
  KeymapAction,
  OrientationMode,
  PlayerKeymap,
  PlayerPrefsData,
  PreferencesPort,
  TextSpeedSource,
  TimerHandle,
  TimerPort,
  WindowSize,
} from "../../contracts/index.ts";
import {
  AUTO_DELAY_MS_RANGE,
  DIALOGUE_HEIGHT_SCALE_RANGE,
  DIALOGUE_POSITIONS,
  ELEMENT_FITS,
  FONT_FAMILY_MAX,
  FONT_SCALE_RANGE,
  LANGUAGE_MAX,
  NVL_PAGE_SIZE_RANGE,
  TRANSITION_SPEED_RANGE,
  hostTimer,
} from "../../contracts/index.ts";
import { clamp01, isOrientationMode } from "../../shared/index.ts";
import { sanitize, sanitizeKeymap } from "./sanitize.ts";
import { snapshotPrefs } from "./snapshot.ts";

/** 偏好变更回调；收到的是快照副本，调用方改写它不会穿透到内部状态 */
type PrefsListener = (data: PlayerPrefsData) => void;

/** 持久化防抖静默窗缺省值：滑块拖动连发 set 合并为一次落盘 */
const PERSIST_DEBOUNCE_MS = 300;

/** 偏好防抖注入口：宿主可按平台调整落盘静默窗（毫秒） */
export interface PreferencesOptions {
  /** 持久化防抖静默窗（毫秒）；缺省 300 */
  persistDebounceMs?: number;
}

/** 数值 setter 共用：非有限数忽略（fail-closed），其余钳到值域 */
function clampOrIgnore(
  value: number,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/**
 * 玩家偏好状态机。构造缺省端口 = 纯内存模式（hydrate/dispose 空操作）。
 */
export class PlayerPreferences {
  /** 当前偏好真值；由 sanitize 产出，可选字段缺失表示「未设置」而不是默认值 */
  private data: PlayerPrefsData;
  /** 变更订阅者；Set 保证同一监听器重复注册也只收到一次回调 */
  private readonly listeners = new Set<PrefsListener>();
  /** 防抖计时器句柄，非 null 表示还有一次落盘待补发 */
  private pendingSave: TimerHandle | null = null;
  /** 持久化端口；缺省 = 纯内存模式 */
  private readonly port?: PreferencesPort;
  /** 定时器端口（防抖延迟回调来源；缺省 hostTimer） */
  private readonly timer: TimerPort;
  /** 防抖静默窗（毫秒）；缺省 300 */
  private readonly persistDebounceMs: number;

  constructor(
    port?: PreferencesPort,
    timer?: TimerPort,
    options?: PreferencesOptions,
  ) {
    this.port = port;
    this.timer = timer ?? hostTimer;
    this.persistDebounceMs = options?.persistDebounceMs ?? PERSIST_DEBOUNCE_MS;
    this.data = sanitize(undefined);
  }

  /** 只读快照（新引用——UI 可安全持有做响应式镜像）；可选字段缺省 = 键不存在 */
  snapshot(): PlayerPrefsData {
    return snapshotPrefs(this.data);
  }

  /** 是否静音；为 true 时 effectiveVolume 一律归零，但各通道音量偏好照旧保留 */
  get muted(): boolean {
    return this.data.muted;
  }

  /** 文本显示速度（单位口径由渲染层解释）；下限 1，非法写入被忽略 */
  get textSpeed(): number {
    return this.data.textSpeed;
  }

  /** 字速归属（undefined = 未声明，玩家偏好覆盖故事设置；见 TextSpeedSource） */
  get textSpeedSource(): TextSpeedSource | undefined {
    return this.data.textSpeedSource;
  }

  /** 设置字速归属（只认 "story"/"player"，其余忽略——fail-closed 不抛出） */
  setTextSpeedSource(source: TextSpeedSource): void {
    if (source !== "story" && source !== "player") return;
    if (this.data.textSpeedSource === source) return;
    this.update({ ...this.data, textSpeedSource: source });
  }

  /** 清除字速归属 = 回到缺省行为（玩家偏好覆盖故事设置） */
  clearTextSpeedSource(): void {
    if (this.data.textSpeedSource === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.textSpeedSource;
    this.update(next);
  }

  /** 方向偏好（undefined = 未设置，跟随工程默认/auto；壳应用由组合根负责） */
  get orientation(): OrientationMode | undefined {
    return this.data.orientation;
  }

  /** 指定通道的偏好音量（0..1，未经静音/主音量合成）；从未设置过该通道时回默认值 */
  volume(channel: AudioChannel): number {
    return this.data.volumes[channel];
  }

  /** 主音量（0..1，缺省 = 1）：合成末端的总闸，乘在通道偏好之上 */
  get masterVolume(): number {
    return this.data.masterVolume ?? 1;
  }

  /** 有效音量（合成末端）：静音归零，否则 通道偏好 × 主音量（0..1） */
  effectiveVolume(channel: AudioChannel): number {
    if (this.data.muted) return 0;
    return clamp01(this.data.volumes[channel] * this.masterVolume);
  }

  /** 设置单通道音量：非有限数忽略，其余钳到 0..1（fail-closed，不抛出） */
  setVolume(channel: AudioChannel, value: number): void {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    this.update({
      ...this.data,
      volumes: { ...this.data.volumes, [channel]: clamp01(value) },
    });
  }

  /** 设置主音量：非有限数忽略，其余钳到 0..1；渲染层经 effectiveVolume 自动受益 */
  setMasterVolume(value: number): void {
    const next = clampOrIgnore(value, 0, 1);
    if (next === undefined || next === this.data.masterVolume) return;
    this.update({ ...this.data, masterVolume: next });
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

  /** 即时文本（缺省 = false）：true 整句直出；不改变故事跳过权限 */
  get instantText(): boolean {
    return this.data.instantText ?? false;
  }

  /** 设置即时文本（非布尔忽略） */
  setInstantText(on: boolean): void {
    if (typeof on !== "boolean" || on === this.instantText) return;
    this.update({ ...this.data, instantText: on });
  }

  /** 自动播放停留时长（毫秒，缺省 1500）：打字机完成后距上次推进至少等这么久 */
  get autoDelayMs(): number {
    return this.data.autoDelayMs ?? 1500;
  }

  /** 设置自动播放停留时长：非整数/非有限数忽略，整数钳到值域（与 sanitize 同口径） */
  setAutoDelayMs(ms: number): void {
    if (typeof ms !== "number" || !Number.isInteger(ms)) return;
    const next = Math.min(
      AUTO_DELAY_MS_RANGE.max,
      Math.max(AUTO_DELAY_MS_RANGE.min, ms),
    );
    if (next === this.data.autoDelayMs) return;
    this.update({ ...this.data, autoDelayMs: next });
  }

  /** 自动播放开关（缺省 false）：宿主据此装配自动推进节奏 */
  get autoEnabled(): boolean {
    return this.data.autoEnabled ?? false;
  }

  /** 设置自动播放开关（非布尔忽略） */
  setAutoEnabled(on: boolean): void {
    if (typeof on !== "boolean" || on === this.autoEnabled) return;
    this.update({ ...this.data, autoEnabled: on });
  }

  /** 快进停留时长（毫秒，缺省 50；消费归快进功能） */
  get skipDelayMs(): number {
    return this.data.skipDelayMs ?? 50;
  }

  /** 仅快进已读（缺省 false）：true 时快进遇到未读句即停（Ren'Py 同口径） */
  get skipUnseenOnly(): boolean {
    return this.data.skipUnseenOnly ?? false;
  }

  /** 设置仅快进已读（非布尔忽略） */
  setSkipUnseenOnly(on: boolean): void {
    if (typeof on !== "boolean" || on === this.skipUnseenOnly) return;
    this.update({ ...this.data, skipUnseenOnly: on });
  }

  /** 打字音效开关（缺省 false）：核心只发事件，资源归宿主；无资源时宿主禁用开关 */
  get typeSound(): boolean {
    return this.data.typeSound ?? false;
  }

  /** 转场速度倍率（缺省 1）：乘在故事转场时长上 */
  get transitionSpeed(): number {
    return this.data.transitionSpeed ?? 1;
  }

  /** 设置转场速度倍率：非有限数忽略，钳到值域（禁 0/负防除零） */
  setTransitionSpeed(value: number): void {
    const next = clampOrIgnore(
      value,
      TRANSITION_SPEED_RANGE.min,
      TRANSITION_SPEED_RANGE.max,
    );
    if (next === undefined || next === this.data.transitionSpeed) return;
    this.update({ ...this.data, transitionSpeed: next });
  }

  /** 抖动强度倍率（缺省 1，0 = 关抖动） */
  get shakeScale(): number {
    return this.data.shakeScale ?? 1;
  }

  /** 设置抖动强度倍率：非有限数忽略，钳到 0..1 */
  setShakeScale(value: number): void {
    const next = clampOrIgnore(value, 0, 1);
    if (next === undefined || next === this.data.shakeScale) return;
    this.update({ ...this.data, shakeScale: next });
  }

  /** 减弱动效（undefined = 跟随系统；三态，见 resolveReducedMotion） */
  get reducedMotion(): boolean | undefined {
    return this.data.reducedMotion;
  }

  /** 设置减弱动效（非布尔忽略）；显式值覆盖系统偏好 */
  setReducedMotion(on: boolean): void {
    if (typeof on !== "boolean" || on === this.data.reducedMotion) return;
    this.update({ ...this.data, reducedMotion: on });
  }

  /** 清除减弱动效 = 回到跟随系统 */
  clearReducedMotion(): void {
    if (this.data.reducedMotion === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.reducedMotion;
    this.update(next);
  }

  /** 故事文本字号倍率（缺省 1） */
  get fontScale(): number {
    return this.data.fontScale ?? 1;
  }

  /** 设置字号倍率：非有限数忽略，钳到值域 */
  setFontScale(value: number): void {
    const next = clampOrIgnore(
      value,
      FONT_SCALE_RANGE.min,
      FONT_SCALE_RANGE.max,
    );
    if (next === undefined || next === this.data.fontScale) return;
    this.update({ ...this.data, fontScale: next });
  }

  /** 对话框不透明度（undefined = 跟随作者样式；三态） */
  get dialogueOpacity(): number | undefined {
    return this.data.dialogueOpacity;
  }

  /** 设置对话框不透明度：非有限数忽略，钳到 0..1 */
  setDialogueOpacity(value: number): void {
    const next = clampOrIgnore(value, 0, 1);
    if (next === undefined || next === this.data.dialogueOpacity) return;
    this.update({ ...this.data, dialogueOpacity: next });
  }

  /** 清除对话框不透明度 = 回到跟随作者样式 */
  clearDialogueOpacity(): void {
    if (this.data.dialogueOpacity === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.dialogueOpacity;
    this.update(next);
  }

  /** 对话框位置（undefined = 跟随作者样式；闭合词表） */
  get dialoguePosition(): DialoguePosition | undefined {
    return this.data.dialoguePosition;
  }

  /** 设置对话框位置（闭合词表外忽略） */
  setDialoguePosition(position: DialoguePosition): void {
    if (!DIALOGUE_POSITIONS.includes(position)) return;
    if (position === this.data.dialoguePosition) return;
    this.update({ ...this.data, dialoguePosition: position });
  }

  /** 清除对话框位置 = 回到跟随作者样式 */
  clearDialoguePosition(): void {
    if (this.data.dialoguePosition === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.dialoguePosition;
    this.update(next);
  }

  /** 对话框高度倍率（undefined = 跟随作者样式） */
  get dialogueHeightScale(): number | undefined {
    return this.data.dialogueHeightScale;
  }

  /** 设置对话框高度倍率：非有限数忽略，钳到值域 */
  setDialogueHeightScale(value: number): void {
    const next = clampOrIgnore(
      value,
      DIALOGUE_HEIGHT_SCALE_RANGE.min,
      DIALOGUE_HEIGHT_SCALE_RANGE.max,
    );
    if (next === undefined || next === this.data.dialogueHeightScale) return;
    this.update({ ...this.data, dialogueHeightScale: next });
  }

  /** 清除对话框高度倍率 = 回到跟随作者样式 */
  clearDialogueHeightScale(): void {
    if (this.data.dialogueHeightScale === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.dialogueHeightScale;
    this.update(next);
  }

  /** 默认字体（undefined = 跟随工程默认；逐句/角色显式字体优先；宿主校验注册表） */
  get fontFamily(): string | undefined {
    return this.data.fontFamily;
  }

  /** 设置默认字体（空串/超长忽略；可用性由宿主装配期校验） */
  setFontFamily(family: string): void {
    if (
      typeof family !== "string" ||
      family.length === 0 ||
      family.length > FONT_FAMILY_MAX ||
      family === this.data.fontFamily
    )
      return;
    this.update({ ...this.data, fontFamily: family });
  }

  /** 清除默认字体 = 回到跟随工程默认 */
  clearFontFamily(): void {
    if (this.data.fontFamily === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.fontFamily;
    this.update(next);
  }

  /** NVL 每页行数（undefined = 不分页全量滚动）：只分页显示，不截断故事缓冲 */
  get nvlPageSize(): number | undefined {
    return this.data.nvlPageSize;
  }

  /** 设置 NVL 每页行数：非整数忽略，钳到值域 */
  setNvlPageSize(value: number): void {
    if (typeof value !== "number" || !Number.isInteger(value)) return;
    const next = Math.min(
      NVL_PAGE_SIZE_RANGE.max,
      Math.max(NVL_PAGE_SIZE_RANGE.min, value),
    );
    if (next === this.data.nvlPageSize) return;
    this.update({ ...this.data, nvlPageSize: next });
  }

  /** 清除 NVL 每页行数 = 回到不分页 */
  clearNvlPageSize(): void {
    if (this.data.nvlPageSize === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.nvlPageSize;
    this.update(next);
  }

  /** 元素填充默认槽（undefined = 内建 cover；op 显式 stretch 优先，见 elementFitOf） */
  get elementFit(): ElementFit | undefined {
    return this.data.elementFit;
  }

  /** 设置元素填充默认槽（闭合五词外忽略） */
  setElementFit(fit: ElementFit): void {
    if (!ELEMENT_FITS.includes(fit) || fit === this.data.elementFit) return;
    this.update({ ...this.data, elementFit: fit });
  }

  /** 清除元素填充默认槽 = 回到内建 cover */
  clearElementFit(): void {
    if (this.data.elementFit === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.elementFit;
    this.update(next);
  }

  /** 窗口尺寸（undefined = 跟随壳初始；仅桌面壳尽力而为） */
  get windowSize(): WindowSize | undefined {
    return this.data.windowSize;
  }

  /** 语言偏好（undefined = 不干预；新会话种子，读档存档语言赢） */
  get language(): string | undefined {
    return this.data.language;
  }

  /** 设置语言偏好（空串/超长忽略）；会话切换语言时宿主调用以记住 */
  setLanguage(language: string): void {
    if (
      typeof language !== "string" ||
      language.length === 0 ||
      language.length > LANGUAGE_MAX ||
      language === this.data.language
    )
      return;
    this.update({ ...this.data, language });
  }

  /** 清除语言偏好 = 回到不干预 */
  clearLanguage(): void {
    if (this.data.language === undefined) return;
    const next: PlayerPrefsData = { ...this.data };
    delete next.language;
    this.update(next);
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
        ? {
            advance: this.data.keymap.advance,
            history: this.data.keymap.history,
          }
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
    this.timer.clear(this.pendingSave);
    this.pendingSave = null;
    void this.port.save(this.snapshot()).catch(() => {});
  }

  /** 唯一写入口：先落真值，再广播快照，最后安排落盘（顺序固定） */
  private update(next: PlayerPrefsData): void {
    this.data = next;
    this.emit();
    this.scheduleSave();
  }

  /** 把同一份快照依次推给所有订阅者；监听器抛错会中断通知并向上冒泡 */
  private emit(): void {
    const snap = this.snapshot();
    for (const listener of this.listeners) listener(snap);
  }

  /** 防抖落盘：静默窗内的连续写入只落最后一次；无端口时跳过；落盘失败被忽略 */
  private scheduleSave(): void {
    if (this.port === undefined) return;
    if (this.pendingSave !== null) this.timer.clear(this.pendingSave);
    this.pendingSave = this.timer.set(() => {
      this.pendingSave = null;
      void this.port?.save(this.snapshot()).catch(() => {});
    }, this.persistDebounceMs);
  }
}

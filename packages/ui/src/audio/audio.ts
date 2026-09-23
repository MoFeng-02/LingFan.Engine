/**
 * 08 §六 音频渲染：核心只写状态（U1），此处把状态差量翻译成端口动作（可测纯逻辑），
 * 由适配器（infra/audioPort）落地播放；资源寻址经 ResourcePort（08-U7），
 * 播放位置回写走帧级键（08 §三.2 / U2）。
 */
import type {
  AudioChannel,
  AudioChannelState,
  AudioPort,
  ResourcePort,
  StoryEngine,
} from "@lingfan/engine";
import { SYS } from "@lingfan/engine";

/** 渲染视图：四通道状态 + bgm 播放位置（帧级键直读，不进事件流） */
export interface AudioView {
  bgm: AudioChannelState | null;
  ambient: AudioChannelState | null;
  voice: AudioChannelState | null;
  se: AudioChannelState | null;
  bgmPosition: number;
}

/** 端口动作：play = 播放/更新/定位/重播，stop = 停止（fadeMs 淡出） */
export type AudioAction =
  | {
      type: "play";
      channel: AudioChannel;
      resource: string;
      volume: number;
      loop: boolean;
      position: number;
      fadeMs: number;
      /** true = 回到 position 重播；false = 同资源无缝续播/更新 */
      restart: boolean;
    }
  | { type: "stop"; channel: AudioChannel; fadeMs: number };

type PlayAction = Extract<AudioAction, { type: "play" }>;

/** 常驻通道（se 为一次性触发，单独按 seq 判定） */
const CHANNELS = ["bgm", "ambient", "voice"] as const;

/** 位置差异阈值（秒）：小于此视为播放器噪声，不打断播放（03-R7 seek 抖动防护） */
const SEEK_THRESHOLD = 0.5;

/** 空视图：渲染器初始差量基准（组合根创建顺序无关，引擎已推进也能补播） */
export const EMPTY_AUDIO_VIEW: AudioView = {
  bgm: null,
  ambient: null,
  voice: null,
  se: null,
  bgmPosition: 0,
};

/**
 * 通道状态读入校验（信任边界：状态可来自被篡改的存档或异版本载荷）：
 * 形态非法一律降级为 null / 安全默认值，绝不把畸形值翻译成播放动作。
 */
function channelState(
  engine: StoryEngine,
  key: string,
): AudioChannelState | null {
  const value = engine.get(key);
  if (value === null || typeof value !== "object") return null;
  const state = value as {
    kind?: unknown;
    resource?: unknown;
    volume?: unknown;
    loop?: unknown;
    fadeMs?: unknown;
    autoStop?: unknown;
    restart?: unknown;
    seq?: unknown;
  };
  const fadeMs =
    typeof state.fadeMs === "number" &&
    Number.isFinite(state.fadeMs) &&
    state.fadeMs > 0
      ? state.fadeMs
      : 0;
  if (state.kind === "stop") return { kind: "stop", fadeMs };
  if (state.kind !== "play") return null;
  if (typeof state.resource !== "string" || state.resource === "") return null;
  const volume =
    typeof state.volume === "number" && Number.isFinite(state.volume)
      ? Math.min(1, Math.max(0, state.volume))
      : 1;
  return {
    kind: "play",
    resource: state.resource,
    volume,
    loop: state.loop === true,
    fadeMs,
    ...(state.autoStop === true ? { autoStop: true } : {}),
    ...(state.restart === true ? { restart: true } : {}),
    ...(typeof state.seq === "number" && Number.isFinite(state.seq)
      ? { seq: state.seq }
      : {}),
  };
}

export function readAudioView(engine: StoryEngine): AudioView {
  const position = engine.get(SYS.bgmPosition);
  return {
    bgm: channelState(engine, SYS.audioBgm),
    ambient: channelState(engine, SYS.audioAmbient),
    voice: channelState(engine, SYS.audioVoice),
    se: channelState(engine, SYS.audioSe),
    bgmPosition: typeof position === "number" ? position : 0,
  };
}

/**
 * 状态差量 → 端口动作（锚点: four-audio-channels）：
 * - 通道由 play 变 stop/null → stop（带淡出参数）
 * - 换资源 → play（bgm 从目标位置起播）
 * - 同资源 + 显式 restart（seq 变化）→ play 回到起点重播
 * - 同资源仅音量/循环变化 → play 更新（适配器不重头播）；bgm 位置差超阈值 → 定位（03-R7）
 * - se 按单调 seq 判定：每次执行都触发一次（同一资源连续触发亦然）
 */
export function planAudioActions(
  prev: AudioView,
  next: AudioView,
): AudioAction[] {
  const actions: AudioAction[] = [];
  for (const channel of CHANNELS) {
    const before = prev[channel];
    const after = next[channel];
    if (after === null || after.kind !== "play") {
      if (before !== null && before.kind === "play") {
        actions.push({
          type: "stop",
          channel,
          fadeMs: after !== null && after.kind === "stop" ? after.fadeMs : 0,
        });
      }
      continue;
    }
    const position = channel === "bgm" ? next.bgmPosition : 0;
    const sameResource =
      before !== null &&
      before.kind === "play" &&
      before.resource === after.resource;
    if (!sameResource) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position,
        fadeMs: after.fadeMs,
        restart: true,
      });
      continue;
    }
    // 同资源：显式重播优先于增量更新（seq 变化 = 这是一次新的重播请求）
    if (after.restart === true && after.seq !== before.seq) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position: 0,
        fadeMs: after.fadeMs,
        restart: true,
      });
      continue;
    }
    if (before.volume !== after.volume || before.loop !== after.loop) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position,
        fadeMs: after.fadeMs,
        restart: false,
      });
      continue;
    }
    if (
      channel === "bgm" &&
      Math.abs(next.bgmPosition - prev.bgmPosition) > SEEK_THRESHOLD
    ) {
      actions.push({
        type: "play",
        channel,
        resource: after.resource,
        volume: after.volume,
        loop: after.loop,
        position,
        fadeMs: 0,
        restart: false,
      });
    }
  }
  const beforeSe = prev.se;
  const afterSe = next.se;
  if (
    afterSe !== null &&
    afterSe.kind === "play" &&
    (beforeSe === null ||
      beforeSe.kind !== "play" ||
      beforeSe.seq !== afterSe.seq)
  ) {
    actions.push({
      type: "play",
      channel: "se",
      resource: afterSe.resource,
      volume: afterSe.volume,
      loop: false,
      position: 0,
      fadeMs: 0,
      restart: true,
    });
  }
  return actions;
}

/** 音频渲染器：订阅通道事件 → 差量应用；位置回写由帧循环驱动 */
export interface AudioRenderer {
  /** 与引擎状态对齐（订阅外的显式同步，如读档/回溯完成） */
  sync(): void;
  /** 帧循环回写播放位置（08 §三.2）：帧级键静默写，不进事件流（U2） */
  pollPosition(): void;
  dispose(): void;
}

export interface AudioRendererOptions {
  /** 资源解析失败诊断（08-U7 报错诊断：不静默吞错） */
  onError?: (message: string) => void;
}

export function createAudioRenderer(
  engine: StoryEngine,
  port: AudioPort,
  resources: ResourcePort,
  options: AudioRendererOptions = {},
): AudioRenderer {
  const audioKeys = new Set<string>([
    SYS.audioBgm,
    SYS.audioSe,
    SYS.audioAmbient,
    SYS.audioVoice,
  ]);
  let view: AudioView = EMPTY_AUDIO_VIEW;
  /**
   * 已解析 URL 缓存（逻辑资源 → URL）：常驻曲目复用解析结果，会话结束统一 release。
   * ponytail: 不做引用计数/中途回收——VN 的资源集合有界，改用 LRU + refcount 的前提是长会话大量换曲。
   */
  const urls = new Map<string, string>();
  /** 每通道动作代际：异步解析落地时若已被更新动作/停止取代，丢弃该次播放（防错播） */
  const generations = new Map<AudioChannel, number>();

  function invalidate(channel: AudioChannel): void {
    generations.set(channel, (generations.get(channel) ?? 0) + 1);
  }

  async function resolveUrl(resource: string): Promise<string | null> {
    const cached = urls.get(resource);
    if (cached !== undefined) return cached;
    try {
      const url = await resources.resolve(resource);
      urls.set(resource, url);
      return url;
    } catch (e) {
      options.onError?.(`资源解析失败：${resource}（${String(e)}）`);
      return null; // fail-closed：不播放（诊断已上报，不静默）
    }
  }

  async function playAction(action: PlayAction): Promise<void> {
    // se 为一次性触发：每次独立播放，不参与代际取消（允许叠放）
    const guarded = action.channel !== "se";
    if (guarded) invalidate(action.channel);
    const generation = generations.get(action.channel);
    const url = await resolveUrl(action.resource);
    if (url === null) return;
    if (guarded && generations.get(action.channel) !== generation) return;
    port.play(action.channel, url, {
      volume: action.volume,
      loop: action.loop,
      position: action.position,
      fadeMs: action.fadeMs,
      restart: action.restart,
    });
  }

  function apply(actions: AudioAction[]): void {
    for (const action of actions) {
      if (action.type === "stop") {
        invalidate(action.channel); // 停止使在途解析作废
        port.stop(action.channel, action.fadeMs);
        continue;
      }
      void playAction(action);
    }
  }

  function sync(): void {
    const next = readAudioView(engine);
    apply(planAudioActions(view, next));
    view = next;
  }

  const off = engine.onStateChanged((change) => {
    if (audioKeys.has(change.key)) sync();
  });
  sync();

  return {
    sync,
    pollPosition(): void {
      const bgm = channelState(engine, SYS.audioBgm);
      if (bgm === null || bgm.kind !== "play") return;
      const seconds = port.position("bgm");
      if (seconds <= 0) return;
      engine.reportMediaPosition(seconds);
      // 同步视图：避免下一帧把自身回写当成 seek 目标
      view = { ...view, bgmPosition: seconds };
    },
    dispose(): void {
      off();
      for (const url of urls.values()) resources.release(url);
      urls.clear();
      generations.clear();
    },
  };
}

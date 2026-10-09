/**
 * 状态读口实现：把系统键读成有类型的值，**形状校验只此一份**。
 *
 * 界面（音频差量、视频命令流、叙事覆盖层）读的都是同一批系统键，而键值是 `unknown`：
 * 引擎自己写下的值总是合法的，但读档会把存档里的值原样灌回状态——存档可被篡改、
 * 也可能来自异版本。所以每个读口方法都先判形状再取值，判不过就退回安全默认值
 * （空串 / 空数组 / `null` / `0`），**绝不把畸形值翻译成有意义的读结果**。
 *
 * 校验集中在这里之前，每处界面各自写一份：形状知识一旦分叉，改一处必漏一处。
 * 契约见 `contracts/runtime/reader.ts`。
 */
import {
  SYS,
  type AudioChannel,
  type AudioChannelState,
  type ElementInstance,
  type LayerId,
  type LayerZOverrides,
  type MenuChoice,
  type StateReader,
  type StateSource,
  type VideoCommand,
} from "../../contracts";
import { INSTANCE_Z_KEYS } from "../shell";

/** 音频通道 ↔ 状态键（通道口径与 `AudioPort` 一致；键名归契约层的 `SYS`） */
const AUDIO_CHANNEL_KEY: Record<AudioChannel, string> = {
  bgm: SYS.audioBgm,
  se: SYS.audioSe,
  ambient: SYS.audioAmbient,
  voice: SYS.audioVoice,
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inUnitRange(value: unknown, fallback: number): number {
  const num = finiteNumber(value);
  return num === null ? fallback : Math.min(1, Math.max(0, num));
}

/**
 * 音频通道状态收窄：`stop` 只认淡出参数，`play` 缺资源或资源为空串即视为「无媒体」。
 *
 * `fadeMs` 非正数按 0（无淡出）算；`volume` 非有限数按 1 并钳到 0..1；
 * `autoStop` / `restart` 只在显式为 `true` 时保留（缺字段与 `false` 同义）；
 * `seq` 只在有限数时保留（它标记「本次写入」，缺失即无从比较先后）。
 */
function channelStateOf(value: unknown): AudioChannelState | null {
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
  const fade = finiteNumber(state.fadeMs);
  const fadeMs = fade !== null && fade > 0 ? fade : 0;
  if (state.kind === "stop") return { kind: "stop", fadeMs };
  if (state.kind !== "play") return null;
  if (typeof state.resource !== "string" || state.resource === "") return null;
  const seq = finiteNumber(state.seq);
  return {
    kind: "play",
    resource: state.resource,
    volume: inUnitRange(state.volume, 1),
    loop: state.loop === true,
    fadeMs,
    ...(state.autoStop === true ? { autoStop: true } : {}),
    ...(state.restart === true ? { restart: true } : {}),
    ...(seq === null ? {} : { seq }),
  };
}

/**
 * 视频命令收窄：五种形态各自判完才放行，判不过一律 `null`（无命令）。
 *
 * `seq` 是去重的唯一依据（同序号不重放），缺失或不合法就无法判断「是否已执行」，
 * 因此整条命令按无效处理——宁可停播，也不把来路不明的资源播出去。
 */
function videoCommandOf(value: unknown): VideoCommand | null {
  if (value === null || typeof value !== "object") return null;
  const command = value as {
    kind?: unknown;
    resource?: unknown;
    volume?: unknown;
    loop?: unknown;
    cutscene?: unknown;
    skipable?: unknown;
    seconds?: unknown;
    seq?: unknown;
  };
  const seq = finiteNumber(command.seq);
  if (seq === null) return null;
  if (command.kind === "play") {
    if (typeof command.resource !== "string" || command.resource === "") {
      return null;
    }
    return {
      kind: "play",
      resource: command.resource,
      volume: inUnitRange(command.volume, 1),
      loop: command.loop === true,
      cutscene: command.cutscene === true,
      skipable: command.skipable === true,
      seq,
    };
  }
  if (command.kind === "seek") {
    const seconds = finiteNumber(command.seconds);
    if (seconds === null || seconds < 0) return null;
    return { kind: "seek", seconds, seq };
  }
  if (command.kind === "pause") return { kind: "pause", seq };
  if (command.kind === "resume") return { kind: "resume", seq };
  if (command.kind === "stop") return { kind: "stop", seq };
  return null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 见契约 `StateReader`：各方法的降级口径写在契约的字段注释里。 */
export function createStateReader(source: StateSource): StateReader {
  const get = (key: string): unknown => source.get(key);
  return {
    audioChannel(channel: AudioChannel): AudioChannelState | null {
      return channelStateOf(get(AUDIO_CHANNEL_KEY[channel]));
    },

    mediaPosition(): number {
      // 帧级键：界面每帧回写；未起播即缺省 0（差量算法把 0 → 0 视为无定位）
      const value = get(SYS.bgmPosition);
      return typeof value === "number" ? value : 0;
    },

    videoCommand(): VideoCommand | null {
      return videoCommandOf(get(SYS.video));
    },

    menuChoices(): MenuChoice[] {
      // 文本与目标分属两个状态条目：任一到达都得重读成对数据，故这里一次读两键
      const texts = get(SYS.menuOptions);
      const targets = get(SYS.menuTargets);
      const textList = Array.isArray(texts) ? texts.map(String) : [];
      const targetList = Array.isArray(targets) ? targets.map(String) : [];
      return textList.map((text, index) => ({
        text,
        target: targetList[index] ?? "",
      }));
    },

    dialogSpeaker(): string {
      return textOf(get(SYS.currentDialogSpeaker));
    },

    dialogText(): string {
      return textOf(get(SYS.currentDialogText));
    },

    dialogColor(): string {
      return textOf(get(SYS.currentDialogColor));
    },

    dialogTemplate(): string | null {
      const value = get(SYS.dialogTemplate);
      return typeof value === "string" ? value : null;
    },

    dialogHidden(): boolean {
      return get(SYS.dialogVisible) === "hide";
    },

    waiting(): string {
      return textOf(get(SYS.waiting));
    },

    menuPrompt(): string {
      return textOf(get(SYS.menuPrompt));
    },

    inputPrompt(): string {
      return textOf(get(SYS.inputPrompt));
    },

    nvlMode(): string {
      return textOf(get(SYS.nvlMode));
    },

    nvlLines(): string[] {
      const value = get(SYS.nvlBuffer);
      return Array.isArray(value) ? value.map(String) : [];
    },

    elements(): ElementInstance[] {
      // 元素写入只经引擎的装载与增删（形状已在解析期校验），这里只判「是不是数组」
      const value = get(SYS.elements);
      return Array.isArray(value) ? (value as ElementInstance[]) : [];
    },

    instanceZOverrides(): LayerZOverrides {
      const overrides: LayerZOverrides = {};
      for (const [layer, key] of Object.entries(INSTANCE_Z_KEYS)) {
        const value = get(key as string);
        if (typeof value === "number") overrides[layer as LayerId] = value;
      }
      return overrides;
    },
  };
}

/**
 * 视图构建：把引擎状态读成一个可比较的快照。
 *
 * 状态经引擎的类型化读口读取（`createStateReader`）：通道形状校验与降级在引擎侧
 * 只有一份，本层只负责「读回来」，不做二次校验。
 */
import type {
  AudioChannelState,
  PlayerPreferences,
  StoryEngine,
} from "@lingfan-engine/core";
import {
  createStateReader,
  SYS,
  isAudioInstanceTable,
} from "@lingfan-engine/core";
import type { AudioView } from "./types.ts";

/** 有效音量合成末端：op 音量 × 通道偏好（prefs 缺省/偏好 1 = 原样，不复制对象） */
function withPrefs(
  state: AudioChannelState | null,
  pref: number | undefined,
): AudioChannelState | null {
  if (state === null || state.kind !== "play") return state;
  if (pref === undefined || pref === 1) return state;
  return { ...state, volume: Math.min(1, Math.max(0, state.volume * pref)) };
}

/**
 * 实例状态快照：形状不合按空表处理（与引擎侧同一判据，不重复做校验）。
 *
 * 实例不在类型化读口里——`StateReader` 只有四通道维度，实例表是「整表一个值」的
 * 通用系统键，这里用引擎的通用读口取回后按契约判据收窄。实例音量不乘玩家偏好：
 * 偏好按通道分档，实例的音量在命令面已按归属通道解析过一次。
 */
function readInstanceStates(
  engine: StoryEngine,
): Readonly<Record<string, AudioChannelState>> {
  const table = engine.get(SYS.audioInstances);
  if (!isAudioInstanceTable(table)) return {};
  const states: Record<string, AudioChannelState> = {};
  for (const id of Object.keys(table).sort()) {
    const entry = table[id];
    if (entry !== undefined) states[id] = entry.state;
  }
  return states;
}

/** prefs 存在时各通道合成玩家有效音量（偏好在视图层落地，planAudioActions 差量自动感知） */
export function readAudioView(
  engine: StoryEngine,
  prefs?: PlayerPreferences,
): AudioView {
  const reader = createStateReader(engine);
  return {
    bgm: withPrefs(reader.audioChannel("bgm"), prefs?.effectiveVolume("bgm")),
    ambient: withPrefs(
      reader.audioChannel("ambient"),
      prefs?.effectiveVolume("ambient"),
    ),
    voice: withPrefs(
      reader.audioChannel("voice"),
      prefs?.effectiveVolume("voice"),
    ),
    se: withPrefs(reader.audioChannel("se"), prefs?.effectiveVolume("se")),
    instances: readInstanceStates(engine),
    bgmPosition: reader.mediaPosition(),
  };
}

/**
 * 偏好快照投影（纯函数）：把内部真值复制成一份新的只读快照，供 UI 安全持有做
 * 响应式镜像。可选字段「缺省 = 键不存在」原样保留（三态信号不丢）；嵌套的键位
 * 数组与窗口尺寸另建引用，UI 改写快照不会穿透回偏好状态。
 */
import {
  KEYMAP_ACTIONS,
  type PlayerKeymap,
  type PlayerPrefsData,
} from "../../contracts/index.ts";

/** 由偏好真值投影出一份隔离的只读快照（新引用，可选键缺席原样保留） */
export function snapshotPrefs(data: PlayerPrefsData): PlayerPrefsData {
  const snap: PlayerPrefsData = {
    v: 1,
    volumes: { ...data.volumes },
    muted: data.muted,
    textSpeed: data.textSpeed,
  };
  if (data.orientation !== undefined) snap.orientation = data.orientation;
  if (data.textSpeedSource !== undefined)
    snap.textSpeedSource = data.textSpeedSource;
  if (data.keymap !== undefined) {
    const keymap: PlayerKeymap = {};
    for (const action of KEYMAP_ACTIONS) {
      const keys = data.keymap[action];
      if (keys !== undefined) keymap[action] = [...keys];
    }
    snap.keymap = keymap;
  }
  if (data.fullscreen !== undefined) snap.fullscreen = data.fullscreen;
  if (data.masterVolume !== undefined) snap.masterVolume = data.masterVolume;
  if (data.instantText !== undefined) snap.instantText = data.instantText;
  if (data.autoDelayMs !== undefined) snap.autoDelayMs = data.autoDelayMs;
  if (data.autoReadCps !== undefined) snap.autoReadCps = data.autoReadCps;
  if (data.autoEnabled !== undefined) snap.autoEnabled = data.autoEnabled;
  if (data.skipDelayMs !== undefined) snap.skipDelayMs = data.skipDelayMs;
  if (data.skipUnseenOnly !== undefined)
    snap.skipUnseenOnly = data.skipUnseenOnly;
  if (data.typeSound !== undefined) snap.typeSound = data.typeSound;
  if (data.transitionSpeed !== undefined)
    snap.transitionSpeed = data.transitionSpeed;
  if (data.shakeScale !== undefined) snap.shakeScale = data.shakeScale;
  if (data.reducedMotion !== undefined) snap.reducedMotion = data.reducedMotion;
  if (data.fontScale !== undefined) snap.fontScale = data.fontScale;
  if (data.dialogueOpacity !== undefined)
    snap.dialogueOpacity = data.dialogueOpacity;
  if (data.dialoguePosition !== undefined)
    snap.dialoguePosition = data.dialoguePosition;
  if (data.dialogueHeightScale !== undefined)
    snap.dialogueHeightScale = data.dialogueHeightScale;
  if (data.fontFamily !== undefined) snap.fontFamily = data.fontFamily;
  if (data.nvlPageSize !== undefined) snap.nvlPageSize = data.nvlPageSize;
  if (data.elementFit !== undefined) snap.elementFit = data.elementFit;
  if (data.windowSize !== undefined) snap.windowSize = { ...data.windowSize };
  if (data.language !== undefined) snap.language = data.language;
  return snap;
}

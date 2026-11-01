import type { AudioView } from "./types.ts";

/** 空视图：渲染器初始差量基准（组合根创建顺序无关，引擎已推进也能补播） */
export const EMPTY_AUDIO_VIEW: AudioView = {
  bgm: null,
  ambient: null,
  voice: null,
  se: null,
  instances: {},
  bgmPosition: 0,
};

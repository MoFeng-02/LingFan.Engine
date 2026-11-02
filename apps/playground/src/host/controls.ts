/**
 * 宿主控制面的 playground 装配：与模板骨架那一份同形同义。
 *
 * 入参是取用函数而不是实例——重启对局会整体重建引擎与音视频端口，旧实例作废；
 * 取用函数每次都读当下那一个，控制面对象本身不必跟着换。
 */
import {
  PERSISTENT_AUDIO_CHANNELS,
  type AudioChannel,
  type AudioPort,
  type HostControls,
  type SaveOptions,
  type StoryEngine,
  type VideoPort,
} from "@lingfan-engine/core";

/** 造一个控制面：方法逐个转调，自身不持有任何状态 */
export function createHostControls(options: {
  /** 取当下的引擎实例（重建后指向新实例） */
  engine: () => StoryEngine;
  /** 取当下的音频端口 */
  audio: () => AudioPort;
  /** 取当下的视频端口 */
  video: () => VideoPort;
  /** 批量暂停与恢复作用于哪些音频通道；缺省三条常驻通道 */
  audioChannels?: readonly AudioChannel[];
}): HostControls {
  const { engine, audio, video } = options;
  // `se` 是一次性音效，没有「暂停后从原位置续播」的语义，批量口径里一律剔除
  const persistent = (
    options.audioChannels ?? PERSISTENT_AUDIO_CHANNELS
  ).filter((channel) => channel !== "se");
  return {
    pause(): void {
      engine().pause();
    },
    resume(): void {
      engine().resume();
    },
    paused(): boolean {
      return engine().paused();
    },
    pauseMedia(channel?: AudioChannel): void {
      if (channel === undefined) {
        for (const each of persistent) audio().pause(each);
        video().pause();
        return;
      }
      if (channel === "se") return;
      audio().pause(channel);
    },
    resumeMedia(channel?: AudioChannel): void {
      if (channel === undefined) {
        for (const each of persistent) audio().resume(each);
        video().resume();
        return;
      }
      if (channel === "se") return;
      audio().resume(channel);
    },
    navigate(columnId: string): void {
      engine().navigate(columnId);
    },
    save(slot: string, options?: SaveOptions): void {
      engine().save(slot, options);
    },
    load(slot: string): void {
      engine().load(slot);
    },
    dispose(): void {
      engine().dispose();
    },
  };
}

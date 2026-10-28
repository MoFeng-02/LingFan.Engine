/**
 * 视频渲染：引擎的 `__video` 命令流 → VideoPort 执行（可测纯编排）。
 * - seq 去重：同一命令只执行一次（重放/读档恢复后的同 seq 不重放）
 * - 资源经 ResourcePort 解析 + 代际取消（迟到的旧解析不误播）
 * - cutscene 自然播放结束 → onVideoFinished（引擎解除 video 等待）
 * 性能：sync 仅由 `__video` 事件与显式调用触发（回溯/读档后对齐），非逐帧。
 */
import type {
  PlayerPreferences,
  ResourcePort,
  VideoCommand,
  VideoPort,
  StoryEngine,
} from "@lingfan-engine/core";
import { createStateReader, SYS } from "@lingfan-engine/core";
import { createResourceUrlCache } from "../resources";

/**
 * 宿主侧回调：只收「出事了」与「放完了」两件本层无法自行处理的事。
 * 都不传也能跑——只是解析失败会静默不播、cutscene 结束后引擎会一直等。
 */
export interface VideoRendererOptions {
  /** 资源解析失败诊断（报错诊断：不静默吞错） */
  onError?: (message: string) => void;
  /** cutscene 自然播放结束（引擎据此解除 video 等待） */
  onVideoFinished?: () => void;
  /**
   * 玩家偏好：视频音轨按 `bgm` 通道的偏好音量衰减（视频没有独立通道，
   * 且音轨语义属「背景音」）。不传 = 不衰减，行为与未接偏好时一致。
   */
  preferences?: PlayerPreferences;
}

/**
 * 视频渲染器：命令的订阅与执行都在工厂内建好，外部只需处理偶尔的显式对齐。
 */
export interface VideoRenderer {
  /** 与引擎命令流对齐（订阅外的显式同步，如回溯/读档完成） */
  sync(): void;
  dispose(): void;
}

/**
 * 造一个视频渲染器并立即订阅引擎的 `__video` 命令流（构造末尾先自同步一次）。
 *
 * 它按 seq 去重、按代际取消迟到的解析结果；资源 URL 经共享缓存取，`dispose` 时逐个
 * `resources.release` 并退订——释放与订阅成对，调用方不必自己记账。
 */
export function createVideoRenderer(
  engine: StoryEngine,
  port: VideoPort,
  resources: ResourcePort,
  options: VideoRendererOptions = {},
): VideoRenderer {
  let lastSeq = -1;
  /** 解析代际：异步解析落地时若已被更新命令取代，丢弃该次播放（防错播） */
  let generation = 0;
  const urls = createResourceUrlCache((resource) =>
    resources.resolve(resource),
  );
  const reader = createStateReader(engine);

  async function resolveUrl(resource: string): Promise<string | null> {
    try {
      return await urls.resolve(resource);
    } catch (e) {
      options.onError?.(`资源解析失败：${resource}（${String(e)}）`);
      return null; // fail-closed：不播放（诊断已上报，不静默）
    }
  }

  /** 播放命令的生效音量：op 音量 × `bgm` 通道偏好（静音由 effectiveVolume 归零） */
  function effectiveVolume(volume: number): number {
    const pref = options.preferences?.effectiveVolume("bgm");
    if (pref === undefined || pref === 1) return volume;
    return Math.min(1, Math.max(0, volume * pref));
  }

  function execute(command: VideoCommand): void {
    generation += 1;
    const gen = generation;
    if (command.kind === "play") {
      void resolveUrl(command.resource).then((url) => {
        if (url === null || generation !== gen) return; // 已被更新命令取代
        port.play(
          url,
          { volume: effectiveVolume(command.volume), loop: command.loop },
          command.cutscene ? () => options.onVideoFinished?.() : undefined,
        );
      });
      return;
    }
    if (command.kind === "pause") {
      port.pause();
      return;
    }
    if (command.kind === "resume") {
      port.resume();
      return;
    }
    if (command.kind === "seek") {
      port.seek(command.seconds);
      return;
    }
    port.stop();
  }

  function sync(): void {
    const command = reader.videoCommand();
    if (command === null) {
      if (lastSeq >= 0) {
        port.stop(); // 命令流被清空（重启/重建）：停播
        lastSeq = -1;
      }
      return;
    }
    if (command.seq === lastSeq) return; // 同命令已执行（重放同 seq 不重放）
    lastSeq = command.seq;
    execute(command);
  }

  const off = engine.onStateChanged((change) => {
    if (change.key === SYS.video) sync();
  });
  // 偏好变化：只调音量不重播（过场正在放时重播会把玩家看到的画面打断）
  const offPrefs =
    options.preferences?.onChange(() => {
      const command = reader.videoCommand();
      if (command === null || command.kind !== "play") return;
      port.setVolume?.(effectiveVolume(command.volume));
    }) ?? null;
  sync();

  return {
    sync,
    dispose(): void {
      off();
      offPrefs?.();
      for (const url of urls.values()) resources.release(url);
      urls.clear();
    },
  };
}

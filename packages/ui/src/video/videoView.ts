/**
 * 08 §六.5 视频渲染：引擎的 `__video` 命令流 → VideoPort 执行（可测纯编排）。
 * - seq 去重：同一命令只执行一次（重放/读档恢复后的同 seq 不重放）
 * - 资源经 ResourcePort 解析（08-U7）+ 代际取消（迟到的旧解析不误播）
 * - cutscene 自然播放结束 → onVideoFinished（引擎解除 video 等待）
 * 性能：sync 仅由 `__video` 事件与显式调用触发（回溯/读档后对齐），非逐帧。
 */
import type {
  ResourcePort,
  VideoCommand,
  VideoPort,
  StoryEngine,
} from "@lingfan/engine";
import { SYS } from "@lingfan/engine";

export interface VideoRendererOptions {
  /** 资源解析失败诊断（08-U7 报错诊断：不静默吞错） */
  onError?: (message: string) => void;
  /** cutscene 自然播放结束（引擎据此解除 video 等待） */
  onVideoFinished?: () => void;
}

export interface VideoRenderer {
  /** 与引擎命令流对齐（订阅外的显式同步，如回溯/读档完成） */
  sync(): void;
  dispose(): void;
}

export function createVideoRenderer(
  engine: StoryEngine,
  port: VideoPort,
  resources: ResourcePort,
  options: VideoRendererOptions = {},
): VideoRenderer {
  let lastSeq = -1;
  /** 解析代际：异步解析落地时若已被更新命令取代，丢弃该次播放（防错播） */
  let generation = 0;
  const urls = new Map<string, string>();

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

  function execute(command: VideoCommand): void {
    generation += 1;
    const gen = generation;
    if (command.kind === "play") {
      void resolveUrl(command.resource).then((url) => {
        if (url === null || generation !== gen) return; // 已被更新命令取代
        port.play(
          url,
          { volume: command.volume, loop: command.loop },
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
    const command = engine.get(SYS.video) as VideoCommand | null | undefined;
    if (command == null) {
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
  sync();

  return {
    sync,
    dispose(): void {
      off();
      for (const url of urls.values()) resources.release(url);
      urls.clear();
    },
  };
}

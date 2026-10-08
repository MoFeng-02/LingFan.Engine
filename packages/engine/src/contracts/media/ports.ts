/**
 * 媒体端口：音频与视频各一条，由适配器实现（WebView 解码，Desktop/Mobile 同契约）。
 * 入参为**已解析 URL**——资源寻址归 ResourcePort，媒体可能是加密资源。
 * 数据形态（通道状态、视频命令）见同目录 `entities.ts`。
 */
import type { AudioChannel, AudioPlayOptions } from "./entities";

/**
 * 音频端口：实现 = infra 适配器（WebView 解码，Desktop/Mobile 同契约）。
 * 入参为已解析 URL（资源寻址归 ResourcePort）；同 URL 且 restart=false = 更新而非重头播。
 */
export interface AudioPort {
  play(channel: AudioChannel, url: string, options: AudioPlayOptions): void;
  stop(channel: AudioChannel, fadeMs?: number): void;
  /** 当前播放位置（秒）；未播放返回 0（帧级回写用） */
  position(channel: AudioChannel): number;
  dispose(): void;
}

// —— 视频（单通道命令流）：新 video 替换当前；Desktop/Mobile 同契约 ——

/**
 * 视频端口：实现 = infra 适配器（WebView 解码，舞台层覆盖呈现）。
 * 入参为已解析 URL（资源寻址归 ResourcePort）。
 * `onEnded`：自然播放结束回调（cutscene 由它解除引擎等待；非阻塞 video 可忽略）。
 */
export interface VideoPort {
  play(
    url: string,
    options: { volume: number; loop: boolean },
    onEnded?: () => void,
  ): void;
  pause(): void;
  resume(): void;
  seek(seconds: number): void;
  stop(): void;
  dispose(): void;
  /**
   * 实例级 z：运行期改本层 z（源 = `video`/`cutscene` 命令上的 `z`；
   * 宿主在实例 z 变化时调用，值由 `resolveInstanceZ("video", 实例z, 表)` 解析）。
   * 可选能力：未实现者保持构造期 `zIndex` 行为（调用方用 `?.` 容错）。
   */
  setZIndex?(z: number): void;
}

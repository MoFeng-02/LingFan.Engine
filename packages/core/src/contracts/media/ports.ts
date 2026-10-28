/**
 * 媒体端口：音频与视频各一条，由适配器实现（WebView 解码，Desktop/Mobile 同契约）。
 * 入参为**已解析 URL**——资源寻址归 ResourcePort，媒体可能是加密资源。
 * 数据形态（通道状态、视频命令）见同目录 `entities.ts`。
 */
import type { AudioChannel, AudioPlayOptions } from "./entities.ts";

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

  // —— 实例维度（可选能力）——
  // 四通道是叙事语义，实例是作者的编排单元：两者并存，不是替换。
  // 三个方法都是**可选**的：老适配器不实现即退化为「实例不发声」，
  // 调用方用 `?.` 容错并上报一次诊断——不能因为端口没跟上就整段卡住。

  /**
   * 起播一个实例（`instanceId` 由作者在故事里命名）。
   *
   * 与 `play` 的三点差别：入参第一维不是通道（归属通道在状态里，供偏好分档）、
   * 同一 id 重复起播是「更新」而非叠放、不同 id 各自独立可叠放。
   */
  playInstance?(
    instanceId: string,
    url: string,
    options: AudioPlayOptions,
  ): void;
  /** 停掉一个实例；`fadeMs` 为淡出毫秒 */
  stopInstance?(instanceId: string, fadeMs?: number): void;
  /**
   * 运行期改一个实例的音量（0..1），**不重播**。
   *
   * 专为「拖滑块实时生效」而设：走 `playInstance` 重发也能改音量，
   * 但那会重设位置、打断正在放的淡入。未实现的适配器只能靠下一次起播生效。
   */
  setVolumeInstance?(instanceId: string, volume: number): void;
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
  /**
   * 运行期改音量（0..1）：偏好滑块拖动时宿主用它，**不重播**——重播会打断过场。
   * 可选能力：未实现者只能靠下一次 `play` 生效（调用方用 `?.` 容错）。
   */
  setVolume?(volume: number): void;
}

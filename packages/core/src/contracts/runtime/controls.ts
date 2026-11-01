/**
 * 宿主控制面：宿主与游戏内挂载 UI 操作引擎的**收窄**通道。
 *
 * 它不是 `StoryEngine` 的别名——引擎有几十个公开方法，其中大半是「引擎内部推进
 * 时顺手通知」的接缝（`animationFinished` / `choose` / `rollbackTo` …），跨形态也
 * 带不进挂载层；这里只留「菜单需要的那几件事」：暂停与恢复、换栏、存读、收摊。
 *
 * 与 `props` 是两条不同的通道，别混：
 * - `props` 来自故事命令的第三参数（`mount(hub, true, {scene: "forest"})`），落在
 *   `SYS.mounts` 里，随快照存档与回溯，因此**必须 JSON 安全**——函数进不去；
 * - `controls` 来自组合根，不进 SSOT、不进快照、运行期注入，**可以带函数**。
 *
 * 组件两样都拿得到：值走 `props`，操作走 `controls`。
 */
import type { AudioChannel } from "../media/entities.ts";

/** 宿主控制面：菜单与挂载 UI 共用的操作集合（两条路实现零差异） */
export interface HostControls {
  /** 暂停整局：推进、等待计时、音频与视频同停；幂等 */
  pause(): void;
  /** 恢复整局：回到暂停前的位置继续；幂等 */
  resume(): void;
  /** 当前是否处于暂停态 */
  paused(): boolean;
  /**
   * 暂停媒体；不传通道即全部常驻通道 + 视频。
   *
   * `se` 是一次性音效，没有「暂停后从原位置续播」的语义——引擎侧同样不动作，
   * 这里显式跳过而不是交给端口各自决定。
   */
  pauseMedia(channel?: AudioChannel): void;
  /** 恢复媒体；参数口径同 {@link HostControls.pauseMedia} */
  resumeMedia(channel?: AudioChannel): void;
  /** 跳到某一栏（与 `menu` 的选项同义：栏 id） */
  navigate(columnId: string): void;
  /** 存档到某个槽位 */
  save(slot: string): void;
  /** 从某个槽位读档 */
  load(slot: string): void;
  /** 拆掉宿主（等同宿主句柄的拆除；由持有者负责只调一次） */
  dispose(): void;
}

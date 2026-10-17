/**
 * 视频呈现面（小程序）：把视频端口的命令落成页面数据，播放中的控制走组件控制柄。
 *
 * 小程序的 `video` 是声明式组件——换片与显示靠页面数据（`src` / 是否可见），
 * 播放中的暂停、续播、定位靠 `uni.createVideoContext(id)` 的控制柄；自然播完由页面
 * 把组件的 `bindended` 转进本面的 `notifyEnded`，端口据此解除引擎的 video 等待。
 *
 * 控制柄按需取：组件还没渲染时取柄会抛错，此时动作直接丢弃（下一次动作再取），
 * 不让一次时序问题炸掉整个宿主。
 */

import type { MiniprogramVideoSurfaceLike } from "@lingfan/adapters";
import { createVideoContext, type UniVideoContext } from "./platform.ts";

/** 页面数据里的视频状态（页面据此渲染 `video` 组件） */
export interface MiniprogramVideoData {
  /** 资源地址（空串 = 无片可播） */
  url: string;
  /** 是否可见：不可见时组件不占位，也不盖住舞台 */
  visible: boolean;
  /** 0..1 */
  volume: number;
  loop: boolean;
}

/** 视频组件的 id：页面模板与呈现面必须一致 */
export const VIDEO_COMPONENT_ID = "stage-video";

/** 呈现面装配参数 */
export interface MiniprogramVideoSurfaceDeps {
  /** 把视频状态落到页面数据 */
  publish(video: MiniprogramVideoData): void;
}

/** 呈现面：端口契约 + 页面侧的播完回传口 */
export interface MiniprogramVideoSurface extends MiniprogramVideoSurfaceLike {
  /** 播放自然结束（页面 `bindended` 转发） */
  notifyEnded(): void;
}

/** 免于无人观看的视频状态（隐藏时页面数据归零） */
const HIDDEN: MiniprogramVideoData = {
  url: "",
  visible: false,
  volume: 0,
  loop: false,
};

/** 造一个视频呈现面 */
export function createMiniprogramVideoSurface(
  deps: MiniprogramVideoSurfaceDeps,
): MiniprogramVideoSurface {
  /** 播完处理器（每次 play 换一次，由端口注册） */
  let ended: (() => void) | null = null;
  /** 当前是否有片在屏（控制柄只在可见时有意义） */
  let visible = false;
  /** 控制柄（懒取；取失败不缓存，下次再试） */
  let context: UniVideoContext | null = null;

  /** 取控制柄：组件未渲染时返回 null（动作丢弃） */
  function readContext(): UniVideoContext | null {
    if (context !== null) return context;
    try {
      context = createVideoContext(VIDEO_COMPONENT_ID);
    } catch {
      return null;
    }
    return context;
  }

  return {
    show(request): void {
      visible = true;
      deps.publish({
        url: request.url,
        visible: true,
        volume: request.volume,
        loop: request.loop,
      });
    },
    hide(): void {
      visible = false;
      deps.publish({ ...HIDDEN });
    },
    pause(): void {
      if (!visible) return;
      readContext()?.pause();
    },
    resume(): void {
      if (!visible) return;
      readContext()?.play();
    },
    seek(seconds): void {
      if (!visible) return;
      readContext()?.seek(Math.max(0, seconds));
    },
    onEnded(callback): void {
      ended = callback;
    },
    notifyEnded(): void {
      ended?.();
    },
  };
}

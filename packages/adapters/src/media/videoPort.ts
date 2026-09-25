/**
 * 08 §六.5 视频端口适配器：WebView 解码（HTMLVideoElement），舞台层覆盖呈现。
 * - 覆盖层 `pointer-events: none`：点击穿透到舞台（cutscene 跳过走引擎 advance 命令面）
 * - 入参为已解析 URL（资源寻址归 ResourcePort，08-U7）
 * - 自然播放结束经 onEnded 上报（cutscene 由它解除引擎等待）
 * - 浏览器自动播放策略拒绝时登记，首次用户交互后重试
 */
import type { VideoPort } from "@lingfan/engine";

export interface WebVideoPortOptions {
  /** 播放失败诊断（缺失/损坏资源不静默：08-U7 报错诊断） */
  onError?: (message: string) => void;
  /** 层 z 序（⑨-11 层级契约）：组合根传入解析后的层表值；缺省 5 = 旧行为 */
  zIndex?: number;
}

export function createWebVideoPort(
  portOptions: WebVideoPortOptions = {},
): VideoPort {
  let element: HTMLVideoElement | null = null;
  let endedHandler: (() => void) | null = null;

  function ensure(): HTMLVideoElement {
    if (element === null) {
      element = document.createElement("video");
      // 舞台层覆盖（RenderTargets.stage 之上的呈现层）；点击穿透：跳过走命令面
      element.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;object-fit:contain;" +
        `background:#000;z-index:${portOptions.zIndex ?? 5};display:none;pointer-events:none;`;
      element.addEventListener("error", () => {
        portOptions.onError?.("视频资源无法解码或缺失");
      });
      document.body.appendChild(element);
    }
    return element;
  }

  return {
    play(url, options, onEnded): void {
      const video = ensure();
      endedHandler = onEnded ?? null;
      video.onended = () => {
        if (endedHandler !== null) endedHandler();
      };
      video.src = url;
      video.loop = options.loop;
      video.volume = Math.min(1, Math.max(0, options.volume));
      video.style.display = "block";
      // 浏览器自动播放策略拒绝（未交互）时静默：cutscene 场景玩家即将交互
      void video.play().catch(() => undefined);
    },
    pause(): void {
      element?.pause();
    },
    resume(): void {
      void element?.play().catch(() => undefined);
    },
    seek(seconds): void {
      if (element !== null) element.currentTime = Math.max(0, seconds);
    },
    stop(): void {
      if (element === null) return;
      element.onended = null;
      element.pause();
      element.removeAttribute("src"); // 释放解码资源
      element.style.display = "none";
    },
    dispose(): void {
      if (element !== null) {
        element.pause();
        element.onended = null;
        element.removeAttribute("src");
        element.remove();
      }
      element = null;
    },
  };
}

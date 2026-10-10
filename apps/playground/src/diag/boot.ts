/**
 * 探针启动节奏：初帧采样一次 + rAF 帧计数当钟采样（f1/f60/f300/f600）
 * + 挂载后前 5 次 DOM 变动采样。由 main.ts 在 `VITE_LFEN_DIAG=1` 构建下
 * 动态引入并调用。
 */
import { snapshot } from "./probe";
import { report } from "./report";

/** 启动探针：初帧采一次 + **rAF 帧计数**当钟采样（f1/f60/f300/f600）+ 挂载后前 5 次 DOM 变动采样。
 *  **不用 `setTimeout` 计时**——iOS 上它的延迟回调会被压住（2s/10s/20s 一处不响）。 */
export function startDiag(): void {
  report({ phase: "probe-start", ua: navigator.userAgent.slice(0, 80) });
  snapshot("t0"); // 初帧（Vue 挂载前，`#app` 必空——该 verdict 已标 initial、不参与归因）
  // **计时器改成 rAF 帧计数**：iOS 上 `setTimeout(>0)` 全被压住（2s/10s/20s 一处不响），
  // 而 rAF 正常触发（raf:1/2/3 已实证）。用帧数当钟，既绕开节流，也顺带证明页面在合成。
  // 帧步长按 60fps 估：60≈1s、300≈5s、600≈10s（覆盖 iOS CI 的 25s 存活窗口前段）。
  const at = new Map<number, string>([
    [1, "f1"],
    [60, "f60"],
    [300, "f300"],
    [600, "f600"],
  ]);
  const raf: typeof window.requestAnimationFrame | undefined =
    window.requestAnimationFrame;
  if (typeof raf === "function") {
    let frame = 0;
    const step = (): void => {
      frame += 1;
      if (frame <= 3) report(`raf:${frame}`); // 渲染存活探针：一次都不触发即「未参与合成」
      const phase = at.get(frame);
      if (phase !== undefined) snapshot(phase);
      if (frame <= 600) raf(step);
    };
    raf(step);
  }
  // 挂载即采：观察者为微任务级投递、不受定时器节流。**不 disconnect**——引擎挂载后会持续改动
  // `#app`，第 5 次变动通常已过「故事从磁盘读进来」那一刻（只采首帧会拍到空壳）。
  const app = document.querySelector("#app");
  if (app !== null) {
    let changes = 0;
    const observer = new MutationObserver(() => {
      changes += 1;
      if (changes <= 5) snapshot(`m${changes}`);
      else observer.disconnect();
    });
    observer.observe(app, { childList: true, subtree: true });
  }
}

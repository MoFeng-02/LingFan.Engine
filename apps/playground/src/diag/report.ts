/**
 * 诊断上报端口：整个 `src/**` 里唯一触达 `window.__TAURI_INTERNALS__.invoke("lfen_diag", …)`
 * 的位置。命令由宿主侧接住并写入 stderr（iOS CI 经 --console-pty 收进 launch 日志，
 * Android 进 logcat）；浏览器形态（无 Tauri IPC）静默跳过。
 * 采样侧（probe / boot）只调用 `report()`，不直接碰 IPC。
 */

/** `window.__TAURI_INTERNALS__` 的最小形状：诊断只依赖 invoke，不 import Tauri API。 */
interface DiagWindow {
  __TAURI_INTERNALS__?: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
}

/** 唯一诊断上报点：payload 序列化后经 `lfen_diag` 发出；浏览器形态（无 Tauri IPC）静默跳过。 */
export function report(payload: unknown): void {
  // 诊断通道自身**绝不允许上抛**：`invoke` 除了返回 rejected promise，也可能**同步抛**
  // （回调/序列化阶段），一旦同步抛就会直接抛出 `setTimeout` 回调、把后面所有采样静默吃掉。
  // 曾观察到只有 `probe-start` 落地、三处采样一字不见，连 catch 里的
  // `probe-error` 也没有——而 WebKit 日志里 +2s/+10s/+20s 各有一次布局催起的资源加载，
  // 证明采样确实跑到了读取几何那一步。故同步与异步两条路都要兜住。
  try {
    const tauri = (window as unknown as DiagWindow).__TAURI_INTERNALS__;
    if (tauri === undefined) return;
    const text = JSON.stringify(payload);
    const result: unknown = tauri.invoke("lfen_diag", { payload: text });
    if (typeof result === "object" && result !== null && "catch" in result) {
      void (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    /* 诊断层失败不得影响页面，也不得吞掉后续采样 */
  }
}

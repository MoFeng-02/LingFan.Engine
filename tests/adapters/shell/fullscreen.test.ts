/**
 * 全屏偏好应用器测试（注入式替身）：Tauri 路径走窗口命令（无需手势）、
 * 浏览器路径走 Fullscreen API（幂等不重复请求）、拒绝/不支持静默（尽力而为契约）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createBrowserFullscreenApplier,
  createTauriFullscreenApplier,
} from "@lingfan/adapters";

describe("createTauriFullscreenApplier（prefs-fullscreen 宿主应用）", () => {
  it("走窗口命令 setFullscreen（无需用户手势）", async () => {
    const setFullscreen = vi.fn().mockResolvedValue(undefined);
    const applier = createTauriFullscreenApplier({ setFullscreen });
    await applier.apply(true);
    await applier.apply(false);
    expect(setFullscreen).toHaveBeenCalledTimes(2);
    expect(setFullscreen).toHaveBeenNthCalledWith(1, true);
    expect(setFullscreen).toHaveBeenNthCalledWith(2, false);
  });

  it("窗口命令拒绝 = 静默不抛（尽力而为契约）", async () => {
    const setFullscreen = vi.fn().mockRejectedValue(new Error("拒绝"));
    const applier = createTauriFullscreenApplier({ setFullscreen });
    await expect(applier.apply(true)).resolves.toBeUndefined();
  });
});

describe("createBrowserFullscreenApplier（prefs-fullscreen 宿主应用）", () => {
  it("Fullscreen API 进出，已全屏时幂等不重复请求", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    let element: object | null = null;
    const doc = {
      get fullscreenElement() {
        return element;
      },
      documentElement: { requestFullscreen },
      exitFullscreen,
    } as unknown as Document;
    const applier = createBrowserFullscreenApplier(doc);
    await applier.apply(true);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(exitFullscreen).not.toHaveBeenCalled();
    element = {};
    await applier.apply(false);
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    await applier.apply(true); // 已在全屏 → 幂等
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("缺用户手势（API 拒绝）= 静默不抛", async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error("需要手势"));
    const doc = {
      fullscreenElement: null,
      documentElement: { requestFullscreen },
    } as unknown as Document;
    const applier = createBrowserFullscreenApplier(doc);
    await expect(applier.apply(true)).resolves.toBeUndefined();
  });
});

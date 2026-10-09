/**
 * 全屏偏好应用器（平台差异收敛归适配器，窗口/文档能力**注入式**——与 TauriInvoke
 * 同风格，测试替身可注入）。尽力而为契约：平台拒绝/不支持 = 静默失败，不算错误
 * （浏览器 Fullscreen API 缺用户手势时会被拒绝——偏好已持久化，下次有手势的切换生效）。
 */

/** 全屏偏好应用接口（实现负责吞掉平台拒绝与不支持） */
export interface FullscreenApplier {
  /** 应用全屏偏好（on = 进入全屏 / off = 退出）；拒绝与不支持均静默 */
  apply(on: boolean): Promise<void>;
}

/** Tauri 窗口命令面（组合根注入 `getCurrentWindow()`；测试注入替身） */
export interface FullscreenWindowLike {
  setFullscreen(on: boolean): Promise<void>;
}

/** Tauri 形态：窗口命令 `setFullscreen`（无需用户手势，启动期恢复亦可应用） */
export function createTauriFullscreenApplier(
  win: FullscreenWindowLike,
): FullscreenApplier {
  return {
    async apply(on: boolean): Promise<void> {
      try {
        await win.setFullscreen(on);
      } catch {
        // 尽力而为：拒绝 = 静默
      }
    },
  };
}

/** 浏览器形态：Fullscreen API（**需要用户手势**；doc 注入便于测试） */
export function createBrowserFullscreenApplier(
  doc: Document = document,
): FullscreenApplier {
  return {
    async apply(on: boolean): Promise<void> {
      try {
        if (on) {
          if (!doc.fullscreenElement) {
            await doc.documentElement.requestFullscreen();
          }
        } else if (doc.fullscreenElement) {
          await doc.exitFullscreen();
        }
      } catch {
        // 尽力而为：缺手势 / 平台不支持 = 静默
      }
    },
  };
}

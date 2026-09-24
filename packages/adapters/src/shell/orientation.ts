/**
 * 08 §八.2 屏幕方向端口适配器：应用是「尽力而为」——平台忽略（Android 16 大屏 /
 * iOS 未声明该方向 / 无壳形态）不算错误，由实现返回布尔告知是否已应用。
 * invoke 可注入（默认动态 import `@tauri-apps/api/core`）：测试以契约替身注入。
 */
import type { OrientationMode, OrientationPort } from "@lingfan/engine";
import { defaultInvoke, type TauriInvoke } from "../resources/projectFilesTauri";

/**
 * Tauri 形态（Desktop + Mobile 同一命令面）：`set_orientation` 由 Rust 侧决定实现——
 * Android 经原生插件写 `Activity.requestedOrientation`；桌面/其余平台 no-op 返回 false。
 */
export function createTauriOrientationPort(
  invoke: TauriInvoke = defaultInvoke,
): OrientationPort {
  return {
    async apply(mode: OrientationMode): Promise<boolean> {
      return await invoke<boolean>("set_orientation", { mode });
    },
  };
}

/** 无壳形态（浏览器宿主）：不存在方向概念，恒未应用（UI 只按返回值提示，不视作错误） */
export function createNoopOrientationPort(): OrientationPort {
  return {
    apply(): Promise<boolean> {
      return Promise.resolve(false);
    },
  };
}

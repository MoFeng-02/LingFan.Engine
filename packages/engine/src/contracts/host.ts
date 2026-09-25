/**
 * ③ 平台区分（宿主信息）：把「跑在哪种系统/哪种形态」收敛为**只读事实**——
 * UI 分支（如桌面隐藏方向开关）与按端行为（存档截图、安全区、能力分层）只认契约，
 * 不认环境变量/UA 猜测。os 取值与 Tauri 官方 `tauri-plugin-os` 的 `platform()` 对齐
 * （windows/macos/linux/android/ios），另设 `unknown` 兜底：无壳浏览器形态拿不到
 * 编译期平台时的**显式未知**（不猜、不伪装）。
 *
 * 取数来源归组合根（Tauri CLI 注入的编译期环境变量 `TAURI_ENV_PLATFORM`，vite `envPrefix`
 * 透传）；解析归 runtime 纯函数；缓存与只读收敛归 adapters 适配器。三者分工与其它端口同构。
 */

/** 具体宿主系统（`unknown` = 无壳浏览器形态等拿不到编译期平台的场景） */
export type HostOs =
  | "windows"
  | "macos"
  | "linux"
  | "android"
  | "ios"
  | "unknown";

/** 宿主形态：desktop = 桌面/浏览器（有窗口、无方向语义）；mobile = 触屏整窗应用 */
export type HostForm = "desktop" | "mobile";

/** 宿主事实（不可变快照） */
export interface HostInfo {
  readonly os: HostOs;
  readonly form: HostForm;
}

/** 宿主端口：只读（宿主事实在进程生命周期内不变，实现可缓存） */
export interface HostPort {
  get(): HostInfo;
}

export const HOST_OS_VALUES: readonly HostOs[] = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "unknown",
];

export function isHostOs(value: unknown): value is HostOs {
  return (
    typeof value === "string" &&
    (HOST_OS_VALUES as readonly string[]).includes(value)
  );
}

/** 由具体 os 派生形态：ios/android = mobile；windows/macos/linux 与 unknown = desktop */
export function hostFormOf(os: HostOs): HostForm {
  return os === "android" || os === "ios" ? "mobile" : "desktop";
}

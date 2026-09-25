/**
 * ③ 宿主信息解析（纯函数，可测）：把宿主提供的「编译期平台字符串」收敛为 HostInfo。
 * 输入 = Tauri CLI 注入的 `TAURI_ENV_PLATFORM`（windows/macos/linux/android/ios，
 * 大小写不敏感）；无法识别/缺省 → `unknown·desktop`（显式未知，不猜）。
 */
import { hostFormOf, type HostInfo, type HostOs } from "../contracts";

/** Tauri 编译期平台 → HostOs（键全部小写，匹配前先归一化） */
const PLATFORM_BY_RAW: Record<string, Exclude<HostOs, "unknown">> = {
  windows: "windows",
  macos: "macos",
  linux: "linux",
  android: "android",
  ios: "ios",
};

export function resolveHost(rawPlatform: string | undefined): HostInfo {
  const key = rawPlatform?.trim().toLowerCase();
  const os: HostOs = (key && PLATFORM_BY_RAW[key]) || "unknown";
  return { os, form: hostFormOf(os) };
}

/**
 * 宿主信息解析（纯函数，可测）：把宿主提供的「编译期平台字符串」收敛为 HostInfo。
 * 输入 = Tauri CLI 注入的 `TAURI_ENV_PLATFORM`（windows/macos/linux/android/ios，
 * 大小写不敏感）；无法识别/缺省 → `unknown·desktop`（显式未知，不猜）。
 */
import {
  type HostCapability,
  type HostInfo,
  type HostOs,
} from "../contracts/index.ts";
import { hostFormOf } from "../shared/index.ts";

/** Tauri 编译期平台 → HostOs（键全部小写，匹配前先归一化） */
const PLATFORM_BY_RAW: Record<string, Exclude<HostOs, "unknown">> = {
  windows: "windows",
  macos: "macos",
  linux: "linux",
  android: "android",
  ios: "ios",
};

/** 把 Tauri 注入的平台字符串解析成 HostInfo；无法识别或缺省一律 unknown + desktop，不猜 */
export function resolveHost(rawPlatform: string | undefined): HostInfo {
  const key = rawPlatform?.trim().toLowerCase();
  const os: HostOs = (key && PLATFORM_BY_RAW[key]) || "unknown";
  return { os, form: hostFormOf(os) };
}

/**
 * 能力比对（纯函数，可测）：返回「组件所需、宿主却没声明」的能力清单。
 *
 * 宿主能力集缺省（undefined）按「未声明任何能力」处理——组件一旦声明了所需能力而宿主
 * 拿不出对应声明，即视为不满足（fail-closed，不静默放行）。组件未声明所需能力（空清单）
 * 时恒返回空，既有宿主与组件的行为因此不变（契约只增、合法输入结果不变）。
 *
 * 比对只读两份纯数据清单，不探测平台/DOM：跨端只换宿主声明，核心零改动。
 */
export function missingHostCapabilities(
  required: readonly HostCapability[],
  available: readonly HostCapability[] | undefined,
): HostCapability[] {
  const have = new Set<HostCapability>(available ?? []);
  return required.filter((capability) => !have.has(capability));
}

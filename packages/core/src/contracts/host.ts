/**
 * 平台区分（宿主信息）：把「跑在哪种系统/哪种形态」收敛为**只读事实**——
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
  "windows" | "macos" | "linux" | "android" | "ios" | "unknown";

/** 宿主形态：desktop = 桌面/浏览器（有窗口、无方向语义）；mobile = 触屏整窗应用 */
export type HostForm = "desktop" | "mobile";

/**
 * 宿主能力：宿主装配时**声明**自己支持哪些渲染/平台通道（video 视频播放、audio 音频、
 * mount 叠加 UI 挂载、body 列身体组件、storage 存档、i18n 文案）。
 *
 * 为什么是数据声明而不是运行时探测：能力集随宿主代码在装配期一次写定（纯 JSON 可序列化），
 * 核心据此做「组件所需能力 vs 宿主能力」的静态比对——不探测 DOM/平台 API，跨端（浏览器/
 * 桌面/小程序）只换宿主声明，核心零改动。探测会把「跑在哪」与「能画什么」耦合成运行期分支，
 * 声明则让两者各自独立、可在装配层 fail-closed。
 */
export type HostCapability =
  "video" | "audio" | "mount" | "body" | "storage" | "i18n";

/** 宿主事实（不可变快照） */
export interface HostInfo {
  readonly os: HostOs;
  readonly form: HostForm;
  /**
   * 宿主能力集（可选只增）：纯数据声明，缺省 = 宿主未声明能力。
   * 消费方对「组件声明了所需能力、宿主却没声明对应能力」按 fail-closed 处理；
   * 组件未声明所需能力时不受影响（合法输入结果不变）。
   */
  readonly capabilities?: readonly HostCapability[];
}

/** 宿主端口：只读（宿主事实在进程生命周期内不变，实现可缓存） */
export interface HostPort {
  get(): HostInfo;
}

/**
 * 宿主操作系统取值的运行时可枚举形式（`HostOs` 联合的字面量清单）。
 *
 * 类型在编译期被擦除，需要遍历或校验取值时用这个数组；
 * `"unknown"` 兜底：宿主无法识别自身平台时归此档，而不是抛错。
 */
export const HOST_OS_VALUES: readonly HostOs[] = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "unknown",
];

/**
 * 宿主能力取值的运行时可枚举形式（`HostCapability` 联合的字面量清单）。
 *
 * 类型在编译期被擦除，需要遍历或校验取值时用这个数组；宿主声明能力集时也应只取这里的值。
 * 桌面/浏览器宿主通常声明全量，小程序宿主按实际渲染通道声明受限子集（如不含 mount）。
 */
export const HOST_CAPABILITY_VALUES: readonly HostCapability[] = [
  "video",
  "audio",
  "mount",
  "body",
  "storage",
  "i18n",
];

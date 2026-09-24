/**
 * 08 §八.2 平台壳能力契约：屏幕方向配置。
 *
 * 方向不是叙事语义——引擎核心不解释、不参与回溯/存档，只提供契约类型；
 * 由组合根读工程默认与玩家偏好、装配给壳层实现（Android `Activity.requestedOrientation` /
 * iOS `UIWindowScene.requestGeometryUpdate` / 无壳形态 no-op）。
 *
 * 平台边界（官方文档已核）：静态声明（AndroidManifest 的 screenOrientation / Info.plist 的
 * UISupportedInterfaceOrientations）决定「允许集合」的上限，本端口只做运行期覆盖——
 * Android 16 起 sw≥600dp 大屏忽略方向限制（游戏凭 `appCategory="game"` 豁免）；
 * iOS 必须在 plist 内声明过该方向且未开启多任务（iPad）才可能生效。
 */

/** 方向模式：auto = 跟随系统与用户自动旋转；portrait/landscape = 锁定方向 */
export type OrientationMode = "auto" | "portrait" | "landscape";

/**
 * 工程级壳配置（project.json `shell` 段）：作者声明的作品形态。
 * 缺省 = auto（跟随系统）；玩家偏好可覆盖（08-U10：偏好与存档分离）。
 */
export interface ProjectShellConfig {
  /** 作品默认方向（缺省 = auto） */
  orientation?: OrientationMode;
}

/**
 * 屏幕方向端口：应用是「尽力而为」——平台忽略（Android 16 大屏 / iOS 未声明该方向 /
 * 无壳形态）时不视为错误，由实现返回布尔告知是否已应用；非法模式一律拒绝（fail-closed）。
 */
export interface OrientationPort {
  apply(mode: OrientationMode): Promise<boolean>;
}

/** 方向模式校验（载荷信任边界：偏好文件与工程清单都可能被篡改或来自异版本） */
export function isOrientationMode(value: unknown): value is OrientationMode {
  return value === "auto" || value === "portrait" || value === "landscape";
}

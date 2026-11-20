/**
 * 玩家偏好运行时出口（聚合入口，只转发不含实现）：
 * 状态机（state）+ 信任边界校验（sanitize）+ 优先级链解析（resolve）。
 * 偏好与存档分离、三态「缺省 ≠ 显式」纪律见各册头注。
 */
export { PlayerPreferences, type PreferencesOptions } from "./state.ts";
export {
  resolveTextSpeed,
  resolveReducedMotion,
  resolveLanguage,
  type TextSpeedResolution,
  type ReducedMotionResolution,
  type LanguageResolution,
} from "./resolve.ts";

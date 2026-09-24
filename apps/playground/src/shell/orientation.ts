/**
 * 壳配置解析（宿主侧纯函数，08 §八.2）：工程默认与玩家偏好的优先级链。
 * 优先级：**玩家显式偏好 > 工程默认（project.json shell.orientation）> auto**
 * ——玩家显式选 auto（跟随系统）优先于作者默认，这是「偏好覆盖」的应有语义。
 * 清单入参为 `unknown`（供给端口只保证「取到」）：两处来源都是信任边界
 * （本地文件可被篡改/异版本），非法值一律降级为「未声明」。
 */
import { isOrientationMode, type OrientationMode } from "@lingfan/engine";

/** 读工程默认方向（清单非法/缺声明 = undefined） */
export function manifestOrientation(
  manifest: unknown,
): OrientationMode | undefined {
  if (manifest === null || typeof manifest !== "object") return undefined;
  const shell = (manifest as { shell?: unknown }).shell;
  if (shell === null || typeof shell !== "object") return undefined;
  const orientation = (shell as { orientation?: unknown }).orientation;
  return isOrientationMode(orientation) ? orientation : undefined;
}

/** 方向优先级链解析（组合根据此装配壳端口；纯函数可测） */
export function resolveOrientationMode(
  preference: OrientationMode | undefined,
  manifestDefault: OrientationMode | undefined,
): OrientationMode {
  return preference ?? manifestDefault ?? "auto";
}

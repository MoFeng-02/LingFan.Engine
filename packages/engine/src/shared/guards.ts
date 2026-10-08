/**
 * 判定函数：把运行期到手的 `unknown` 值收窄成契约里声明的类型。
 *
 * 契约层只声明类型，而值总是先以 `unknown` 出现——偏好文件、工程清单、故事文件
 * 都可能被改坏或来自异版本，所以每次读入都得先判后用。这些判定集中在契约层之外，
 * 契约层因此保持「零实现」：任何层引用契约类型都不会牵进运行期代码。
 *
 * 判定只回答「形状对不对」，不抛错也不兜底；判不过就由调用方 fail-closed
 * （拒绝整个载荷，而不是猜一个默认值）。
 */
import { ELEMENT_TYPES, type ElementType } from "../contracts/element";
import { HOST_OS_VALUES, type HostForm, type HostOs } from "../contracts/host";
import type { OrientationMode } from "../contracts/shell";
import type { SceneType, StoryColumn } from "../contracts/story";

/** 是否是 36 个舞台元素类型之一 */
export function isElementType(value: unknown): value is ElementType {
  return (
    typeof value === "string" &&
    (ELEMENT_TYPES as readonly string[]).includes(value)
  );
}

/** 玩法系统写状态的键：`game.<systemId>.<key>`，与作者变量、`ext.` 三方隔离 */
export function gameScopedKey(systemId: string, key: string): string {
  return `game.${systemId}.${key}`;
}

/** 是否是已知的宿主系统（`unknown` 是合法取值：拿不到编译期平台时的显式未知） */
export function isHostOs(value: unknown): value is HostOs {
  return (
    typeof value === "string" &&
    (HOST_OS_VALUES as readonly string[]).includes(value)
  );
}

/** 由系统值派生宿主形态：ios / android 是触屏整窗应用，其余（含未知）按桌面处理 */
export function hostFormOf(os: HostOs): HostForm {
  return os === "android" || os === "ios" ? "mobile" : "desktop";
}

/** 是否是已知的屏幕方向模式 */
export function isOrientationMode(value: unknown): value is OrientationMode {
  return value === "auto" || value === "portrait" || value === "landscape";
}

/** 是否是已知的场景类型（非法值由解析层 fail-closed，这里只做收窄） */
export function isSceneType(value: unknown): value is SceneType {
  return value === "game" || value === "menu" || value === "ui";
}

/**
 * 该列是否参与历史与存档：`type` 缺省按 `game` 算，`menu` / `ui` 不参与。
 *
 * **单一判定点**——引擎的写入守卫与编辑器的章节分组都调用这里，谁都不许另写一份，
 * 否则两侧对「哪些列进存档」的理解会分叉。
 */
export function isReplayableColumn(column: Pick<StoryColumn, "type">): boolean {
  return (column.type ?? "game") === "game";
}

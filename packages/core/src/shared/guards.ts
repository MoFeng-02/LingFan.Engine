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
import { ELEMENT_TYPES, type ElementType } from "../contracts/element.ts";
import {
  HOST_OS_VALUES,
  type HostForm,
  type HostOs,
} from "../contracts/host.ts";
import type { OrientationMode } from "../contracts/shell.ts";
import type { SceneType, StoryColumn } from "../contracts/story/index.ts";

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

/**
 * 是否是**普通对象**（JSON 意义上的记录）：`null` 与数组都不算。
 *
 * **单一判定点**——数据层的结构校验（元素节点、列对象、工程清单）都调用这里，
 * 谁都不许另写一份：少写一个 `!Array.isArray` 就会让数组通过对象校验，
 * 那是**静默的行为变化**（解析器会拿下标当字段名继续走）。
 */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 是否是契约承认的场景类型（**只认 `game` / `ui`**）。
 *
 * 调用点都在「拒绝非法输入」的位置：故事文件里写别的值一律 fail-closed 报错，
 * 不静默当剧情——那种错要等存档/回溯出问题才发现，代价极高。
 */
export function isSceneType(value: unknown): value is SceneType {
  return value === "game" || value === "ui";
}

/**
 * 把外部输入的场景类型拼写归一为契约值：`game` / `ui`。
 *
 * **单一归一函数**：解析层已用 `isSceneType` fail-closed 拒绝非法值，
 * 这里只负责「缺省」这一种合法输入——`undefined` → `game`。
 *
 * 为什么仍单独成函数：`type` 的缺省语义（不写 = 剧情）在 JSON 解析、DSL 解析、
 * 读侧兜底三处都要用，散写三份 `?? "game"` 会让「缺省是什么」出现三个答案。
 *
 * 注意：**归一是读侧兜底，不是校验**。故事文件里的非法 `type` 要 fail-closed 报错，
 * 那是解析层（`columnShapeDefect`）的职责，不靠这里静默吃掉。
 */
export function normalizeSceneType(raw: unknown): SceneType {
  return isSceneType(raw) ? raw : "game";
}

/**
 * 该列是否参与历史与存档：`type` 缺省按 `game` 算，`ui` 不参与。
 *
 * **单一判定点**——引擎的写入守卫与编辑器的章节分组都调用这里，谁都不许另写一份，
 * 否则两侧对「哪些列进存档」的理解会分叉。
 */
export function isReplayableColumn(column: Pick<StoryColumn, "type">): boolean {
  return sceneTypeOf(column) === "game";
}

/**
 * 列的**归一化**运行语义类型：缺省（以及解析层已 fail-closed 的非法值）一律取 `game`。
 *
 * **为什么需要它**：`isReplayableColumn` 只回答「参不参与存档」，回答不了「是哪一种」。
 * 宿主列清单与状态读口要的是具体类型，若各自写 `column.type ?? "game"`，
 * 缺省口径就分叉了。归一口径本身归 `normalizeSceneType`，这里只是它的列级入口。
 *
 * 注意：**这是读侧归一**。故事文件里的非法 `type` 由解析层拒收，不靠这里兜底。
 */
export function sceneTypeOf(column: Pick<StoryColumn, "type">): SceneType {
  return normalizeSceneType(column.type);
}

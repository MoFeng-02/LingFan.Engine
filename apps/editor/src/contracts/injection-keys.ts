/**
 * 注入键：宿主与视图之间约定的取用入口。
 *
 * 为什么用具名常量而不是裸字符串：键名是双方约好的名字，写错一个字母时，
 * 裸字符串只会在运行时静默取到 `undefined`（组件照常渲染，只是功能不响应），
 * 常量则当场编译失败。键所携带的类型也随常量一起传下去，
 * `inject` 拿到的值不必再手写泛型——那种写法正是「同一个键在不同组件里被写成不同类型」的源头。
 *
 * 注意：这些键只在本应用内使用，不属于引擎或适配器的对外契约。
 */
import type { InjectionKey, Ref } from "vue";
import type { ColumnGroupingView } from "@lingfan/editor";
import type { EditorApiPort } from "./editor";

/** 编辑操作面（见 `./editor`） */
export const EDITOR_API_KEY: InjectionKey<EditorApiPort> =
  Symbol("lingfan-editor-api");

/**
 * 列 id → 来源文件路径。
 *
 * 章节树据此把「列」按作者的目录编排分组。可选：单文件工程没有路径概念，
 * 取不到时章节树退化为「无分组的全列表」，不报错。
 */
export const COLUMN_PATHS_KEY: InjectionKey<Ref<Map<string, string>>> =
  Symbol("lingfan-editor-column-paths");

/** 当前选中的 JSON Pointer（`null` = 未选中） */
export const SELECTED_POINTER_KEY: InjectionKey<Ref<string | null>> =
  Symbol("lingfan-editor-selected-pointer");

/**
 * 列分组视图的读写面。
 *
 * 与编辑操作面分开：分组只是作者的视图偏好——不产生撤销单元、不置脏、不进故事 JSON。
 */
export interface ColumnGroupingApi {
  /** 当前分组视图（只读投影；改动经下面几个方法提交） */
  view: Ref<ColumnGroupingView>;
  addGroup(name: string): void;
  renameGroup(groupId: string, name: string): void;
  removeGroup(groupId: string): void;
  /** `groupId` 为 `null` = 把该列移出分组 */
  assignColumn(columnId: string, groupId: string | null): void;
  toggleCollapsed(groupId: string): void;
}

export const COLUMN_GROUPING_API_KEY: InjectionKey<ColumnGroupingApi> = Symbol(
  "lingfan-editor-column-grouping-api",
);

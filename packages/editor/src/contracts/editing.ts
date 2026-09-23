/**
 * 06 编辑核心契约：故事树纯映射器（D1：只读写故事 JSON，不碰运行时/Rust）+
 * 统一 undo（所有视图共享，一次提交 = 一个 undo 单元）。
 * 锚点: editor-is-pure-mapper / unified-undo-across-views
 */

import type { Story } from "@lingfan/engine";

/** 一次编辑提交（一个 undo 单元）：before/after 以不可变结构共享 */
export interface UndoEntry {
  label: string;
  before: Story;
  after: Story;
}

/** 编辑器会话观察者：任何视图提交后收到新故事树（一处改动全视图同步） */
export type StoryListener = (story: Story) => void;

/** 命令容器（01 §一.3 两类列） */
export type ContainerField = "commands" | "entry" | "elements";

/** 列的命令容器元数据：flow → commands；scene → entry（入口命令）与 elements（元素） */
export interface ContainerInfo {
  columnId: string;
  columnPointer: string;
  kind: "scene" | "flow";
}

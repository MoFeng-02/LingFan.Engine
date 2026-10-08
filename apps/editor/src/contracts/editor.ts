/**
 * 编辑操作面：视图组件把「用户想改什么」交回宿主的那组方法。
 *
 * 为什么单独成契约：同一组方法原先在十一个组件里各写一份，成员互不相同——
 * 组件调用前先声明一份自己看得见的，宿主实现时又得回头对齐这些副本，
 * 于是同一份能力在不同文件里慢慢长成不同样子。
 * 收成一份后：宿主按它实现（对象成员对不上会在类型检查期报错），
 * 组件按它取用（拿到的是同一份定义，不会再出现「这个组件以为有、那个组件以为没有」）。
 *
 * 注意：契约只描述**能力形状**，不含实现——提交、undo、选中怎么做都在宿主。
 * 某些组件只会用到其中几个成员，多出来的成员不影响它们。
 */
import type { Story } from "@lingfan/engine";

export interface EditorApiPort {
  /** 写入字段值（`pointer` 指向该字段本身） */
  update(pointer: string, value: unknown): void;
  /** 删除可选字段（置空即删） */
  removeField(pointer: string): void;
  /** 向数组容器插入命令或元素草稿（`pointer` 指向数组；缺省追加到末尾） */
  insertCommand(pointer: string, command: Record<string, unknown>): void;
  removeCommand(pointer: string): void;
  moveCommand(pointer: string, delta: number): void;
  /**
   * 就地选中，不改视图。
   *
   * 与 `reveal` 分开：`select` 只负责选中；「切回时间线并滚动到目标行」是另一件事。
   * 两者若混在一起，舞台视图复用 `select` 会在按下指针的瞬间被切走，拖拽随即失效。
   */
  select(pointer: string | null): void;
  /** 选中并把目标行滚到视口中央（诊断面板与步骤视图要「点了看得见」） */
  reveal(pointer: string): void;
  /** 选中列；同时把命令指针指向列本身（舞台视图据此判断当前列） */
  selectColumn(id: string): void;
  renameColumn(from: string, to: string): void;
  /**
   * 新增列。
   * `type` 是运行语义轴（与列的形状正交）；缺省不写字段。
   */
  addColumn(
    kind: "flow" | "scene",
    hint?: string,
    type?: "game" | "menu" | "ui",
  ): void;
  removeColumn(id: string): void;
  /** 元素落点创建（`parentPointer` 指向容器元素；一次拖入算一次撤销单元） */
  insertElement(
    columnPointer: string,
    element: Record<string, unknown>,
    parentPointer?: string,
  ): void;
  /** 拉线建分支；组合不合法时返回 `false`（由调用方给出提示） */
  connectBranch(
    fromColumnId: string,
    toColumnId: string,
    optionText?: string,
  ): boolean;
  /** 整树替换（JSON 视图 / 文本模式 / 导入共用；一次替换算一次撤销单元） */
  replaceAll(next: Story, label: string): void;
}

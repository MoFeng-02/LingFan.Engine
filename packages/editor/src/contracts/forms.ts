/**
 * 06-D2 表单契约：属性面板表单描述符，由 op schema（Zod 单一事实源）派生。
 * 锚点: schema-driven-forms
 */

/** op 分组（属性面板/时间线插入菜单的呈现归类） */
export type OpGroup =
  | "narrative"
  | "presentation"
  | "flow"
  | "variables"
  | "save"
  | "audio"
  | "video"
  | "minigame";

/**
 * 字段呈现语义（驱动诊断扫描面与表单控件选型）：
 * - text：插值面（先 Translate 后插值 + {var} 求值，行内标记透传）
 * - expression：表达式面（cond/on/in；失败即停机）
 * - value：任意值（字符串 {expr}/复合赋值 = 表达式，其余字面量）
 * - identifier：变量/列/函数/槽位名
 * - resource：资源逻辑路径（经 ResourcePort 寻址）
 */
export type FieldKind =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "text"
  | "expression"
  | "value"
  | "identifier"
  | "resource"
  | "array"
  | "object"
  | "tuple"
  /** 命令体（if.then/while.body 等）：子面板递归编辑 */
  | "body";

export interface FieldDescriptor {
  /** 本层字段名（嵌套项内的字段相对该项根） */
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  hasDefault: boolean;
  defaultValue?: unknown;
  /** enum 可选值 */
  enumValues?: readonly string[];
  /** array/tuple 的元素描述 */
  item?: FieldDescriptor;
  tupleItems?: FieldDescriptor[];
  /** object 的子字段 */
  properties?: FieldDescriptor[];
}

export interface OpMeta {
  op: string;
  label: string;
  group: OpGroup;
}

export interface OpFormDescriptor {
  op: string;
  label: string;
  group: OpGroup;
  fields: FieldDescriptor[];
}

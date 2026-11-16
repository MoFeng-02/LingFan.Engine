/**
 * 变量域 op 负载：set / define / let / local 四键共用赋值负载，
 * 以及 undef / array / array_push / array_pop / dict / dict_set。
 *
 * 负载用 type 别名而非 interface：TS 只给对象字面量类型隐式索引签名，
 * CommandOf 产物要能赋给 StoryCommand（开放索引签名），负载必须是
 * 字面量类型形态。value 收状态槽值域（含 null）；null 只属状态槽。
 */
import type { StateScriptValue } from "./shared.ts";

/** 赋值四兄弟共用：key 是状态槽键，value 是状态槽值域 */
export type AssignOpPayload = {
  key: string;
  value: StateScriptValue;
};

/** undef：删除状态槽键 */
export type UndefOpPayload = {
  key: string;
};

/** array：声明数组槽。once 为真时仅首次生效；items 收状态槽值域 */
export type ArrayOpPayload = {
  key: string;
  items: StateScriptValue[];
  once?: boolean;
};

/** array_push：向数组槽追加一个状态槽值 */
export type ArrayPushOpPayload = {
  key: string;
  value: StateScriptValue;
};

/** array_pop：弹出数组槽末元素 */
export type ArrayPopOpPayload = {
  key: string;
};

/** dict：声明字典槽。value 是字符串键 → 状态槽值；once 同 array */
export type DictOpPayload = {
  key: string;
  value: Record<string, StateScriptValue>;
  once?: boolean;
};

/** dict_set：写字典槽的单个字段 */
export type DictSetOpPayload = {
  key: string;
  field: string;
  value: StateScriptValue;
};

/** 变量域 op → 负载登记（域 map 住域文件，总登记只 extends） */
export interface VarsPayloadMap {
  set: AssignOpPayload;
  define: AssignOpPayload;
  let: AssignOpPayload;
  local: AssignOpPayload;
  undef: UndefOpPayload;
  array: ArrayOpPayload;
  array_push: ArrayPushOpPayload;
  array_pop: ArrayPopOpPayload;
  dict: DictOpPayload;
  dict_set: DictSetOpPayload;
}

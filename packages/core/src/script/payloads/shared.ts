/**
 * 跨域负载片段：标量值 / 状态值 / 块体 / 空负载。
 *
 * 与 editor 校验器片段（zod Value/StateValue/Body/strictObject({})）一一对应：
 * 类型面只承载结构；非空/有限/正则等运行期约束是校验器职责，不进类型面。
 */

/** op 负载标量值（字面量 / `{expr}` 表达式串 / `+=` 复合赋值串） */
export type ScriptValue = string | number | boolean;

/** 状态类 op 负载值：共享 ScriptValue + null（null 只属状态槽） */
export type StateScriptValue = ScriptValue | null;

/** 块体：嵌套命令数组。嵌套校验由 editor validateStory 递归，类型面保持 unknown */
export type ScriptBody = unknown[];

/**
 * 空负载（无字段 op）。必须是 type 别名：interface 空体无隐式索引签名，
 * `interface Empty {} extends Record<string, never>` 为 false，
 * 会使 CommandOf 的空负载特判失效。
 */
export type EmptyOpPayload = Record<string, never>;

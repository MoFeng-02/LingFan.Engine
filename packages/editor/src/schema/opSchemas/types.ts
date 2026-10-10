import { z } from "zod";
import { OP_SCHEMA_MAP } from "./map";
import { Value } from "./fragments";

// ====== 类型派生（与 schema 同源 ⇒ 字段面零漂移）======

/** 内建 op 名字面量全集 */
export type ScriptOpName = keyof typeof OP_SCHEMA_MAP & string;

/**
 * 单 op 命令类型：`CommandOf<"bgm">` = `{ op: "bgm" } & 负载形状`。
 * 派生自 `OP_SCHEMA_MAP` ⇒ schema 增删字段时类型自动跟随。
 *
 * **条件类型必须保持可分发**（naked `K extends`）：不加分发时
 * `CommandOf<ScriptOpName>` 会折叠成 `{ op: 全体字面量 } & (全体 infer 联合)`——
 * 全可选负载（如 nvl）成为逃生舱，缺必填不再报红。
 * 空 schema（strictObject({}) 的 infer = `Record<string, never>`，会与 op 键冲突）
 * 特判为纯 `{ op: K }`。
 */
export type CommandOf<K extends ScriptOpName> = K extends ScriptOpName
  ? z.infer<(typeof OP_SCHEMA_MAP)[K]> extends Record<string, never>
    ? { op: K }
    : { op: K } & z.infer<(typeof OP_SCHEMA_MAP)[K]>
  : never;

/**
 * **内建 op 判别联合**（裸写命令的强类型形态）：`op` 决定可用字段——
 * `op: "say"` ⇒ text/speaker/z… 编译期可查；未知 op / 未知字段 / 类型错编译期报红
 * （与编辑期 `validateCommand` 的 unknown-op / unknown-field 同口径，提前到构建期）。
 *
 * **对内建 op 闭合，不带索引签名逃生舱**：联合里任何 `{[k: string]: unknown}`
 * 成员都会让所有字面量可指派到它，废掉整个联合的多余属性检查。
 * 扩展 op 走 `extOp()`（产物 = StoryCommand envelope）或显式 `: StoryCommand`
 * 注解——显式逃生 > 隐式漏洞。
 */
export type ScriptCommand = CommandOf<ScriptOpName>;

/** op 负载标量值（字面量 / `{expr}` 表达式串 / `+=` 复合赋值串——与 zod `Value` 同源） */
export type ScriptValue = z.infer<typeof Value>;

/**
 * 命令类型机制：op 判别联合（裸写命令的强类型形态）。
 *
 * 与 editor 校验器的类型派生（z.infer<OP_SCHEMA_MAP>）同构：
 * - 类型参数约束 `K extends ScriptOpName` 与 editor 现行形态逐字一致
 *   （未知 op = TS2344 类型实参错）；
 * - 条件类型保持 naked K 可分发：联合入参逐成员分发，防全可选负载成为
 *   「任意 op 都合法」的逃生舱（缺必填不再报红）；
 * - 空负载特判为纯 `{ op: K }`（不带多余字段位）；
 * - ScriptCommand 对内建 op 闭合，不带索引签名——扩展 op 走 extOp()
 *   或显式 `: StoryCommand` 注解（显式逃生 > 隐式漏洞）。
 */
import type { OpPayloadMap } from "./payloads/map.ts";

export type {
  ScriptValue,
  StateScriptValue,
  ScriptBody,
  EmptyOpPayload,
} from "./payloads/shared.ts";

/** 内建 op 名字面量全集（派生自负载总登记） */
export type ScriptOpName = keyof OpPayloadMap & string;

/** 单 op 命令类型：`CommandOf<"say">` = `{ op: "say" } & 负载形状` */
export type CommandOf<K extends ScriptOpName> = K extends ScriptOpName
  ? OpPayloadMap[K] extends Record<string, never>
    ? { op: K }
    : { op: K } & OpPayloadMap[K]
  : never;

/** 内建 op 判别联合：op 决定可用字段 */
export type ScriptCommand = CommandOf<ScriptOpName>;

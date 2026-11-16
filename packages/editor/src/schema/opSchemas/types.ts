/**
 * 命令类型转发面：op 负载类型的单一声明在 core（@lingfan-engine/core/script）。
 * zod schema（map.ts / commands.ts）降为校验器——运行期校验职责不变，
 * 类型 ↔ 校验的一致性由 satisfies 与双向锁测试守护（不再天然同源派生）。
 * 转发链保持：opSchemas/index → schema/index → script/index → 包根。
 */
export type {
  CommandOf,
  ScriptCommand,
  ScriptOpName,
  ScriptValue,
  StateScriptValue,
} from "@lingfan-engine/core/script";
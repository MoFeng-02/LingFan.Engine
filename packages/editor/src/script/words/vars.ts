/**
 * Script 词汇层 · **变量域**（set / define / let / local / undef / array / dict）。
 * value 参数 = 引擎 Value（字面量 / `{expr}` 表达式串 / `+=` 复合赋值串——口径同 JSON v1）。
 */
import type { CommandOf, ScriptValue } from "../../schema/opSchemas";

export function set(key: string, value: ScriptValue): CommandOf<"set"> {
  return { op: "set", key, value };
}

export function define(key: string, value: ScriptValue): CommandOf<"define"> {
  return { op: "define", key, value };
}

/** ⚠️ `let` 为 JS 语句关键字 ⇒ 别名 `letVar` */
export function letVar(key: string, value: ScriptValue): CommandOf<"let"> {
  return { op: "let", key, value };
}

export function localVar(key: string, value: ScriptValue): CommandOf<"local"> {
  return { op: "local", key, value };
}

export function undef(key: string): CommandOf<"undef"> {
  return { op: "undef", key };
}

export function newArray(
  key: string,
  items: readonly ScriptValue[],
  opts?: { once?: boolean },
): CommandOf<"array"> {
  return { op: "array", key, items: [...items], ...opts };
}

/** 逐个压入（op 契约 = 单值 {key, value}；多件就多次调用） */
export function arrayPush(
  key: string,
  value: ScriptValue,
): CommandOf<"array_push"> {
  return { op: "array_push", key, value };
}

export function arrayPop(key: string): CommandOf<"array_pop"> {
  return { op: "array_pop", key };
}

export function dict(
  key: string,
  record: Record<string, ScriptValue>,
  opts?: { once?: boolean },
): CommandOf<"dict"> {
  return { op: "dict", key, value: { ...record }, ...opts };
}

export function dictSet(
  key: string,
  field: string,
  value: ScriptValue,
): CommandOf<"dict_set"> {
  return { op: "dict_set", key, field, value };
}

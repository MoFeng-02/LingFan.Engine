/**
 * Script 词汇层 · **变量域**（set / define / let / local / undef / array / dict）。
 * value 参数 = 引擎 Value（字面量 / `{expr}` 表达式串 / `+=` 复合赋值串——口径同 JSON v1）。
 */
import type { CommandOf, ScriptValue } from "../../schema";

/**
 * 把值写进状态变量：沿作用域链找到 `key` 已声明的层写入；
 * 找不到声明层就写进全局状态（全局变量随快照/存档/回溯走）。
 *
 * - `value` 传字面量直接存；传 `"{expr}"` 表达式串则在运行到这里时求值。
 * - 支持复合赋值串 `"+= 1"` / `"-= 2"` / `"*= 3"` / `"/= 4"` / `"%= 5"`
 *   （只对数字有意义；除以 0 直接报错停机）。
 *
 * @param key 变量名（之后用 `{key}` 插值显示）。
 * @param value 字面量或 `"{expr}"` 表达式串。
 * @returns `set` 故事命令。
 * @example
 * set("gold", 100);
 * set("gold", "{gold + 50}");   // 表达式在运行期求值
 * set("gold", "+= 10");
 */
export function set(key: string, value: ScriptValue): CommandOf<"set"> {
  return { op: "set", key, value };
}

/**
 * 声明全局变量的初值：**只在变量不存在时生效**（重复执行/重复经过
 * 不会覆盖已有值）。适合做关卡开场的默认设定。
 * @param key 全局变量名。
 * @param value 初值（字面量或 `"{expr}"` 表达式串）。
 * @returns `define` 故事命令。
 * @example
 * define("visitedInn", false);
 */
export function define(key: string, value: ScriptValue): CommandOf<"define"> {
  return { op: "define", key, value };
}

/**
 * 在**当前最内层作用域**声明一个临时变量（块/列级）：出了这段作用域
 * 自动销毁，不进存档。适合循环计数、分支内临时值。
 * @param key 变量名。
 * @param value 初值（字面量或 `"{expr}"` 表达式串）。
 * @returns `let` 故事命令。
 * @example
 * letVar("i", 0);
 */
export function letVar(key: string, value: ScriptValue): CommandOf<"let"> {
  return { op: "let", key, value };
}

/**
 * 同 {@link letVar}：在当前最内层作用域声明临时变量（不进存档）。
 * @param key 变量名。
 * @param value 初值（字面量或 `"{expr}"` 表达式串）。
 * @returns `local` 故事命令。
 * @example
 * localVar("tmp", "{gold * 2}");
 */
export function localVar(key: string, value: ScriptValue): CommandOf<"local"> {
  return { op: "local", key, value };
}

/**
 * 销毁变量（沿作用域链与全局层查找）。变量不存在时故事报错停机
 * （fail-closed），便于暴露拼写错误。
 * @param key 要销毁的变量名。
 * @returns `undef` 故事命令。
 */
export function undef(key: string): CommandOf<"undef"> {
  return { op: "undef", key };
}

/**
 * 创建全局数组：`items` 逐项求值（项可为 `"{expr}"`）后存进全局状态。
 * `once: true` 时数组已存在则跳过，不覆盖（幂等声明）。
 * @param key 数组变量名。
 * @param items 初始元素列表。
 * @param opts 可选项：once 已存在则跳过。
 * @returns `array` 故事命令。
 * @example
 * newArray("party", ["alice", "bob"], { once: true });
 */
export function newArray(
  key: string,
  items: readonly ScriptValue[],
  opts?: { once?: boolean },
): CommandOf<"array"> {
  return { op: "array", key, items: [...items], ...opts };
}

/**
 * 向**已存在**的数组末尾追加一个值（值可为 `"{expr}"`）。目标不存在或
 * 不是数组时故事报错停机。逐个压入：多件就多次调用。
 * @param key 目标数组变量名。
 * @param value 要追加的值。
 * @returns `array_push` 故事命令。
 * @example
 * arrayPush("party", "carol");
 */
export function arrayPush(
  key: string,
  value: ScriptValue,
): CommandOf<"array_push"> {
  return { op: "array_push", key, value };
}

/**
 * 移除数组末尾一个元素（移除即丢弃）。目标不存在、非数组或已空时
 * 故事报错停机。
 * @param key 目标数组变量名。
 * @returns `array_pop` 故事命令。
 */
export function arrayPop(key: string): CommandOf<"array_pop"> {
  return { op: "array_pop", key };
}

/**
 * 创建全局字典（JSON 对象：字段名 → 值，值可为 `"{expr}"`）。
 * `once: true` 时字典已存在则跳过，不覆盖。
 * @param key 字典变量名。
 * @param record 字段与初值的映射。
 * @param opts 可选项：once 已存在则跳过。
 * @returns `dict` 故事命令。
 * @example
 * dict("hero", { hp: 30, mp: 10 }, { once: true });
 */
export function dict(
  key: string,
  record: Record<string, ScriptValue>,
  opts?: { once?: boolean },
): CommandOf<"dict"> {
  return { op: "dict", key, value: { ...record }, ...opts };
}

/**
 * 修改字典的单个字段（值可为 `"{expr}"`）。目标不存在或不是字典时
 * 故事报错停机。
 * @param key 目标字典变量名。
 * @param field 字段名。
 * @param value 新值。
 * @returns `dict_set` 故事命令。
 * @example
 * dictSet("hero", "hp", "{hero.hp - 5}");
 */
export function dictSet(
  key: string,
  field: string,
  value: ScriptValue,
): CommandOf<"dict_set"> {
  return { op: "dict_set", key, field, value };
}

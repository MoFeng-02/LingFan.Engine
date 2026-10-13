/**
 * InferStateSchema（C12）：把 config.state 数据声明推导为强类型（TS 原生推导，运行期零开销）。
 * 从 `Stories.src/lib/state-type.ts` 迁入包出口（界面规范 对应章节⑤）：形态 A 的 StoryState
 * 类型面 = `InferStateSchema<typeof state>`，由消费工程按需引用，不再依赖 lib 约定。
 *
 * schema 值文法（与编排层 state-schema.ts 的降维一一对应；源形态统一纯嵌套对象，
 * 点路径键已砍——扁平 defines 键由降维展平产生）：
 * - shorthand 字面量（100 / "other" / true）→ 宽类型，嵌套字面量对象递归展开；
 * - descriptor { type: X; default: D } → 类型只由 X 决定：保留字 "number"|"string"|"boolean"
 *   映射原生类型；X 为枚举对象 → 成员值联合（X[keyof X]）；X 为单元素数组 [Leaf] →
 *   InferLeaf<Leaf>[]；X 为多元素数组（as const 元组）→ 成员槽位并集
 *   （InferUnionMember：保留字/null/嵌套并集/[leaf]/枚举对象）；其余兜底 unknown；
 * - 嵌套对象递归展开。
 */

type Primitive = string | number | boolean;

/** descriptor 的 type 槽位 → TS 类型；多元素数组（as const 元组）先行判为并集。 */
type InferTypeRef<X> = X extends readonly [unknown, unknown, ...unknown[]]
  ? InferUnionMember<X[number]>
  : X extends "number"
  ? number
  : X extends "string"
    ? string
    : X extends "boolean"
      ? boolean
      : X extends readonly unknown[]
        ? X extends readonly (infer Leaf)[]
          ? InferLeaf<Leaf>[]
          : never
        : X[keyof X] extends Primitive
          ? X[keyof X]
          : unknown;

/**
 * 并集成员 → TS 类型（分布条件类型：对成员联合逐成员求值）。
 * 顺序即优先级：保留字 → null → 多元素元组（嵌套并集递归）→ 单元素数组 → 枚举对象。
 */
type InferUnionMember<M> = M extends "number"
  ? number
  : M extends "string"
    ? string
    : M extends "boolean"
      ? boolean
      : M extends null
        ? null
        : M extends readonly [unknown, unknown, ...unknown[]]
          ? InferUnionMember<M[number]>
          : M extends readonly (infer Leaf)[]
            ? InferLeaf<Leaf>[]
            : M[keyof M] extends Primitive
              ? M[keyof M]
              : unknown;

/** 数组 descriptor 的元素类型 → TS 类型。 */
type InferLeaf<L> = L extends "number"
  ? number
  : L extends "string"
    ? string
    : L extends "boolean"
      ? boolean
      : L[keyof L] extends Primitive
        ? L[keyof L]
        : never;

/** 单个 schema 值 → TS 类型：descriptor 优先，其次 shorthand 宽类型，嵌套对象递归。 */
type InferValue<V> = V extends {
  readonly type: unknown;
  readonly default: unknown;
}
  ? InferTypeRef<V["type"]>
  : V extends string
    ? string
    : V extends number
      ? number
      : V extends boolean
        ? boolean
        : V extends Record<PropertyKey, unknown>
          ? { -readonly [K in keyof V]: InferValue<V[K]> }
          : unknown;

/** schema 以 as const 声明（字面量/descriptor 判别需要），但 state 运行期可写——推导全程剥 readonly。 */
export type InferStateSchema<T> = {
  -readonly [K in keyof T]: InferValue<T[K]>;
};

import type { InferStateSchema } from "./state-type";

/**
 * state 唯一数据来源（C12）：stateSchema 数据声明 → TS 类型经 InferStateSchema 推导；
 * 引擎初始 defines 由编排层求值降维生成（scripts/build/state-schema.ts）。
 * 词函数逃生舱的字符串键（如 tour.open / bag / gear / ticket）不经本 schema。
 */
export enum Sex {
  Male = "male",
  Female = "female",
}

export const stateSchema = {
  player: {
    gold: 100,
    level: { type: "number", default: 1 },
    sex: { type: Sex, default: Sex.Male },
    name: { type: "string", default: "旅人" },
  },
  dice: { type: "number", default: 1 },
  supplies: { type: ["string"], default: [] },
  mouch: {
    other: "other",
    other2: { type: "string", default: "other2" },
  },
} as const;

export type StoryState = InferStateSchema<typeof stateSchema>;

/** 编译器保留根：declare 纯类型零运行时，编译期按成员链下沉为状态路径文本。 */
export declare const state: StoryState;

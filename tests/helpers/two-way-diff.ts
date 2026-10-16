/**
 * 「同一事实的多处声明之间做双向差集」的共享断言（测试辅助，非生产代码）。
 *
 * op 面的互锁是范式：`dispatch.ts` case 集合、`opRegistry.ts` 的 `BUILTIN_OP_NAMES`、
 * `vocabulary.g.ts` 的 `VOCABULARY_OPS` 之间有双向差集测试——任何一侧新增/删除都会让
 * 另一侧变红。本函数把这套手法抽成可复用的一条，供锚点面、元素面等复用。
 *
 * 两个方向各自独立断言（不在一个 expect 里合并），失败时报告可读的差集内容：
 * - `declaredButMissing`：声明方有、承接方没有（声明未落地）；
 * - `landedButUndeclared`：承接方有、声明方没有（落地无声明，通常是写法漂移）。
 */
import { expect } from "vitest";

/** 一次双向比对的输入：声明集合与承接集合（均为去重前的可迭代） */
export interface TwoWayDiffInput {
  /** 声明方（如规约抽出的锚点 ID、registry 的内建名） */
  declared: Iterable<string>;
  /** 承接方（如测试标题里落地的 ID、dispatch 的 case） */
  landed: Iterable<string>;
  /** 报告里标识声明方的名字（如 "规约锚点"） */
  declaredLabel: string;
  /** 报告里标识承接方的名字（如 "测试落地"） */
  landedLabel: string;
}

/** 双向差集结果（差集为空 = 两侧精确相等） */
export interface TwoWayDiffResult {
  /** 声明方有、承接方没有 */
  declaredButMissing: string[];
  /** 承接方有、声明方没有 */
  landedButUndeclared: string[];
}

/** 纯计算版（供先行探查或自定义断言风格使用）：不抛错，只算差集 */
export function twoWayDiff(input: TwoWayDiffInput): TwoWayDiffResult {
  const declared = new Set(input.declared);
  const landed = new Set(input.landed);
  const declaredButMissing = [...declared].filter((id) => !landed.has(id));
  const landedButUndeclared = [...landed].filter((id) => !declared.has(id));
  return { declaredButMissing, landedButUndeclared };
}

/**
 * 断言版：两侧精确相等，任一方向不为空即失败，失败消息列出差集与两侧标签。
 * 只想锁定子集时，先用 `twoWayDiff` 自算、再对子集做常规 expect。
 */
export function expectTwoWayEqual(input: TwoWayDiffInput): void {
  const result = twoWayDiff(input);
  const messages: string[] = [];
  if (result.declaredButMissing.length > 0) {
    messages.push(
      `${input.declaredLabel}有而${input.landedLabel}没有（声明未落地）：${result.declaredButMissing.join("、")}`,
    );
  }
  if (result.landedButUndeclared.length > 0) {
    messages.push(
      `${input.landedLabel}有而${input.declaredLabel}没有（落地无声明）：${result.landedButUndeclared.join("、")}`,
    );
  }
  expect(messages, messages.join("\n")).toEqual([]);
}

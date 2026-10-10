/**
 * i18n 工具链 · 原文键抽取器。
 *
 * 「原文即 key」的正向半边：遍历故事，产出**会被运行期 Translate 的全部原文**
 * （去重、稳定排序）。口径 = `TRANSLATE_SURFACES`（命令流，含嵌套块体）+ 元素 `text`
 * （含 children 递归）——与诊断 `indexStory.originals` 同表同源；互锁测试锁定
 * 「抽取器 ≡ 诊断原文集合 ≡ 运行期真查的键」三方可证。
 */

import type { Story } from "@lingfan/engine";
import { walkStoryCommands, walkStoryElements } from "../schema";
import { isPlainObject } from "../shared";
import { TRANSLATE_SURFACES, valuesAtPath } from "./surfaces";

/**
 * 从故事抽取可翻译原文键集合（= 运行期会查 overlay 表的全部字符串，插值前原文）。
 * 畸形输入 fail-closed 返回空数组；输出**稳定排序**——骨架生成、
 * 对账报告与快照对比的确定性都依赖它。
 */
export function extractStoryKeys(story: Story): string[] {
  if (story === null || typeof story !== "object") return [];
  const keys = new Set<string>();
  walkStoryCommands(story, (cmd) => {
    if (!isPlainObject(cmd) || typeof cmd.op !== "string") return;
    for (const path of TRANSLATE_SURFACES[cmd.op] ?? []) {
      for (const { value } of valuesAtPath(cmd, path)) {
        if (typeof value === "string" && value !== "") keys.add(value);
      }
    }
  });
  // 元素展示文字（运行期 translateElements 同口径：装载时 Translate，递归 children）
  walkStoryElements(story, (node) => {
    if (!isPlainObject(node)) return;
    const text = node.text;
    if (typeof text === "string" && text !== "") keys.add(text);
  });
  return [...keys].sort();
}

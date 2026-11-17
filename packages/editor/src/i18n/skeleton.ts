/**
 * i18n 工具链 · overlay 骨架生成。
 *
 * 给定语言与分组策略，产出**文件内容**（原文 → 既有译文或占位）；落盘归调用方
 * （编辑器保存 / CLI），本模块保持纯函数（不碰平台 API）。文件分组委托
 * `planOverlayPlacement`（落位唯一声明点，故事键 + 宿主键统一落位）；合并语义与
 * 运行期 `mergeOverlayFiles` 对齐 ⇒ 骨架喂回合并后键集合与抽取输出**双向一致**
 * （互锁测试锁定）。
 *
 * **增量判据**：键存在即保留（含空串译文——运行期「命中即用」语义），绝不覆盖；
 * 孤儿键（既有有、源无）默认保留、只由对账报告，`prune` 显式开启才删除。
 * 新键按 `placeholder` 占位。同输入逐字节确定（幂等：连跑两次第二次零改动）。
 */

import {
  planOverlayPlacement,
  type PlacementOptions,
} from "./plan.ts";

/** 占位策略：original = 原文占位（未翻译时画面可读，翻译工作表语义）；empty = 空串（运行期命中即隐句） */
export type SkeletonPlaceholder = "original" | "empty";

// 布局类型声明点在落位层（plan.ts）；这里只转发，保持既有 `from "./skeleton.ts"` 取用不断
export type { SkeletonLayout } from "./plan.ts";

export interface OverlaySkeletonFile {
  /** 相对资源根的 overlay 路径 */
  path: string;
  /** 键值平面（键 = 原文，稳定排序；值 = 既有译文（增量保留）或占位） */
  entries: Record<string, string>;
  /** 序列化好的文件内容（2 空格缩进 + 结尾换行；落盘即用，同输入逐字节确定） */
  content: string;
}

export interface SkeletonOptions extends PlacementOptions {
  /** 增量模式：该语言已存在的 overlay（路径 → 条目）；命中的键保留原值 */
  existing?: ReadonlyMap<string, Record<string, string>>;
  placeholder?: SkeletonPlaceholder;
  /** 显式删除孤儿键（默认 false = 保留只报告）；被删键清单用 prunedOverlayKeys 列出 */
  prune?: boolean;
}

/**
 * 产出骨架文件列表。fail-closed：`lang` / 故事路径 / 宿主路径不合法即抛
 * （校验在 `planOverlayPlacement`，骨架路径不越界）。
 */
export function planOverlaySkeleton(
  options: SkeletonOptions,
): OverlaySkeletonFile[] {
  const { existing, placeholder = "original", prune = false } = options;
  return planOverlayPlacement(options).map((group) => {
    const prior = existing?.get(group.path) ?? {};
    const keys = new Set(group.keys);
    // 孤儿键默认保留（只报告不删）；prune 显式开启才从产物移除
    if (!prune) {
      for (const key of Object.keys(prior)) keys.add(key);
    }
    const entries: Record<string, string> = {};
    for (const key of [...keys].sort()) {
      // 既有条目原样保留（含空串译文）；`undefined` = 未命中 → 占位
      const kept = prior[key];
      entries[key] =
        typeof kept === "string" ? kept : placeholder === "empty" ? "" : key;
    }
    return {
      path: group.path,
      entries,
      content: `${JSON.stringify(entries, null, 2)}\n`,
    };
  });
}
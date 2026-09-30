/**
 * 保存前规范化提示：
 * 「不再提示」偏好持久化 + 提示文案组装。
 *
 * 分层：**检测**归引擎（`detectWriteNormalization`，与 `serializeProject` 同一布局
 * 知识族）；本模块只管编辑器视图侧的两件事——偏好是**本机视图偏好**（边界：
 * 不入故事 JSON、任何存储失败全静默，与列分组同款降级），文案负责把 finding
 * 翻成与真实写回行为一一对应的行。
 */
import type { WriteNormalizationFinding } from "@lingfan/engine";
import type { KeyValueStorage } from "./columnGrouping";

/** 「不再提示」键（全局一次性偏好，非按工程——规范化行为是引擎布局规则，不随工程变） */
export const NORMALIZATION_NOTICE_PREF_KEY = "lingfan-editor-skip-normalization-notice";

/** 读偏好：键缺失 / 坏值 / 存储失败一律 `false`（提示默认开启，fail-open 到可见侧） */
export function readSkipNormalizationNotice(
  storage: KeyValueStorage | undefined,
): boolean {
  try {
    return storage?.getItem(NORMALIZATION_NOTICE_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

/** 写偏好：`true` 记 `"1"`、`false` 记 `"0"`（读侧只认 `"1"`）；失败静默 = 仅本次会话有效 */
export function writeSkipNormalizationNotice(
  storage: KeyValueStorage | undefined,
  skip: boolean,
): void {
  try {
    storage?.setItem(NORMALIZATION_NOTICE_PREF_KEY, skip ? "1" : "0");
  } catch {
    /* 存储不可用（配额 / 隐私模式）= 偏好仅本次会话有效 */
  }
}

/**
 * finding → 提示行（每行对应一个真实文件级动作；码元序稳定输出）。
 * 空 finding → 空数组（界面据此不渲染提示）。
 */
export function describeNormalization(
  finding: WriteNormalizationFinding,
): string[] {
  const lines: string[] = [];
  for (const path of finding.toConvert) {
    const json = `${path.slice(0, -".story".length)}.json`;
    lines.push(`「${path}」将转换为标准 JSON 列文件「${json}」（内容等价）`);
  }
  for (const path of finding.toRemove) {
    lines.push(
      `「${path}」将从磁盘移除（内容重组为按列命名的单列文件，或已不被当前故事引用）`,
    );
  }
  return lines;
}

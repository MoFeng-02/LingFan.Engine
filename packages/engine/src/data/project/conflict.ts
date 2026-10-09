import { byPath, STORIES_DIR, isSafeFileNameSegment } from "./naming";
import type { FileStamp, WriteNormalizationFinding } from "../../contracts";

/**
 * 写回的保存前检测：覆盖冲突与规范化提示。
 * 都是纯函数——只根据传入的既有状态给出「要不要拦」，不碰平台。
 */
/**
 * 写回冲突判定：
 * 打开工程的指纹快照 vs 保存时刻磁盘现状，不一致 = 外部改动会被**静默覆盖**。
 * - 基线文件**消失**（current 无此路径）→ 冲突（被外部删除）；
 * - `lastModified` / `size` 任一不同 → 冲突；
 * - 基线没有的路径（wanted 新增文件）不在检测面——新建不冲突；
 * - 写回成功后基线快照整体换新 → 自己的保存永不自报。
 */
export function detectWriteConflicts(
  baseline: ReadonlyMap<string, FileStamp>,
  current: ReadonlyMap<string, FileStamp | undefined>,
): string[] {
  const conflicts: string[] = [];
  for (const [path, stamp] of baseline) {
    const now = current.get(path);
    if (now === undefined) {
      conflicts.push(path);
      continue;
    }
    if (now.lastModified !== stamp.lastModified || now.size !== stamp.size) {
      conflicts.push(path);
    }
  }
  return conflicts;
}

/** 冲突的可操作文案（前 3 条路径 + 总数；指引两条出路） */
export function conflictMessage(paths: readonly string[]): string {
  const head = paths.slice(0, 3).join("、");
  const more = paths.length > 3 ? ` 等 ${paths.length} 个文件` : "";
  return (
    `磁盘已被外部修改（${head}${more}）：现在保存将覆盖这些改动。` +
    `请先重新打开工程确认，或放弃本次保存。`
  );
}

/**
 * 对比「打开时磁盘上的故事文件」与当前故事的标准布局（每列一个 `Stories/<id>.json`，
 * 与 `serializeProject` 同一布局规则），列出**保存将触发的规范化动作**。
 *
 * 判定只看路径形态（本函数与 `serializeProject`/`diffProjectFiles` 同属布局知识族）：
 * 打开时存在、标准布局里没有的文件即规范化对象——`Stories/<列id>.story` 是「转换」，
 * 其余（多列文件 / 文件名与列 id 不一致 / 不再被引用的遗留）是「移除」。
 *
 * - 输入恒不修改；`Stories/` 之外的路径不在写回白名单内，一律忽略；
 * - 不安全列 id（`isSafeFileNameSegment` 拒绝）构不出标准布局键——该列对应的磁盘文件
 *   会落入「移除」，但真保存会被 `serializeProject` 整批拒绝，检测不抢跑它的 fail-closed；
 * - 空列集 = 保存将清空 `Stories/` 的全部引用文件 → 全部「移除」（如实报告）。
 */
export function detectWriteNormalization(
  openedStoryPaths: readonly string[],
  columnIds: readonly string[],
): WriteNormalizationFinding {
  const wanted = new Set<string>();
  const idSet = new Set<string>(columnIds);
  for (const id of columnIds) {
    if (isSafeFileNameSegment(id)) {
      wanted.add(`${STORIES_DIR}/${id}.json`);
    }
  }
  const toConvert: string[] = [];
  const toRemove: string[] = [];
  for (const path of openedStoryPaths) {
    if (!path.startsWith(`${STORIES_DIR}/`) || wanted.has(path)) continue;
    const base = path.slice(STORIES_DIR.length + 1);
    const dot = base.lastIndexOf(".");
    const seg = dot > 0 ? base.slice(0, dot) : "";
    if (base.endsWith(".story") && seg !== "" && idSet.has(seg)) {
      toConvert.push(path);
    } else {
      toRemove.push(path);
    }
  }
  return {
    toConvert: toConvert.sort(byPath),
    toRemove: toRemove.sort(byPath),
  };
}

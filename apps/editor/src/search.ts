/**
 * 全局搜索的**纯模型**：在资源文本里检索，返回命中位置。
 *
 * 为何是纯函数：搜索的判据（大小写、整词、命中行号、结果上限、排序）是**可测规则**，
 * 而规则在 UI 里极易悄悄错（一个 `slice` 写错就少报结果）。
 *
 * 范围纪律：**只搜资源内容**，不搜「注册面」（模板/命令/说话人索引）——
 * 那是 B2 的另一块（读三张既有的表，见方向稿 §4），与内容搜索是两个独立能力。
 *
 * 命中判据用**纯文本子串**（不建倒排索引）：资源集是「一个工程的若干文件」量级，
 * 线性扫描足够；建索引属于过度设计。
 */

import { kindOfPath, type ResourceKind } from "./resourceTree";

/** 一条命中 */
export interface SearchHit {
  /** 资源逻辑路径 */
  readonly path: string;
  readonly kind: ResourceKind;
  /** 1 基行号（与编辑器/文件查看器口径一致） */
  readonly line: number;
  /** 命中行的原文（未裁剪，由展示层决定是否截断） */
  readonly text: string;
  /** 命中词在该行内的 0 基列 */
  readonly column: number;
}

/** 搜索输入：路径 → 内容（由宿主供给，**本模块不碰 IO**） */
export type SearchCorpus = ReadonlyMap<string, string>;

export interface SearchOptions {
  /** 命中上限（保护渲染：超大工程别一次渲染十万行） */
  readonly limit?: number;
  /** 是否大小写敏感（默认否） */
  readonly caseSensitive?: boolean;
}

export interface SearchReport {
  readonly hits: readonly SearchHit[];
  /** 是否因上限截断（UI 应如实提示"还有更多"，不谎报"共 3 条"） */
  readonly truncated: boolean;
  /** **实际扫描过**的文件数（提前截断时 < 语料总数；不谎报扫了全部） */
  readonly searchedFiles: number;
}

const DEFAULT_LIMIT = 200;

/**
 * 逐文件逐行检索。
 *
 * 空查询 ⇒ **零命中**（不是"全部命中"）——空白输入不该触发全量扫描。
 */
export function searchResources(
  corpus: SearchCorpus,
  query: string,
  options: SearchOptions = {},
): SearchReport {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const caseSensitive = options.caseSensitive ?? false;
  const needle = caseSensitive ? query : query.toLowerCase();
  if (query === "" || needle === "") {
    return { hits: [], truncated: false, searchedFiles: 0 };
  }
  // 先按路径码元序遍历 ⇒ 结果顺序确定（同输入必同输出）
  const paths = [...corpus.keys()].sort();
  const hits: SearchHit[] = [];
  let truncated = false;
  let scanned = 0;
  for (const path of paths) {
    const content = corpus.get(path);
    if (content === undefined) continue;
    scanned += 1; // 计入**实际扫过**（`searchedFiles` 的诚实口径）
    const lines = content.split("\n");
    for (const [i, rawLine] of lines.entries()) {
      const haystack = caseSensitive ? rawLine : rawLine.toLowerCase();
      const at = haystack.indexOf(needle);
      if (at < 0) continue;
      if (hits.length >= limit) {
        truncated = true;
        break;
      }
      hits.push({
        path,
        kind: kindOfPath(path),
        line: i + 1,
        text: rawLine,
        column: at,
      });
    }
    if (truncated) break;
  }
  return { hits, truncated, searchedFiles: scanned };
}

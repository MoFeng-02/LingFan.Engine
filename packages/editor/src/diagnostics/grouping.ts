/**
 * 诊断面板 · **按类型分组与折叠判据**（纯函数，可测）。
 *
 * 存在理由：诊断面板是编辑期的「仪表盘」，而工程里**同质诊断会淹没异质诊断**
 * —— 常见情形是 33 条里 31 条都是 `unused-translation`，把 2 条真错误
 * （`undefined-variable`）埋掉了。根因是**信息架构**（无分组/折叠），
 * **不是排版**：调间距/字号救不了「扫读」。
 *
 * 排序与折叠两条规则都写在这里（视图只渲染 + 收集意图）：
 *
 * 1. **严重度优先**（`error` 在前）⇒ 真错误永远浮在顶部，不被警告挤下去。
 * 2. **同严重度按条数降序** ⇒ 最「成灾」的类型最显眼（1 条 warning 不该压过 8 条 warning）。
 * 3. **同条数按 code 码元序** ⇒ 组间顺序确定，不随输入顺序抖动。
 *
 * **组内也按 pointer 排序**（不是保留输入顺序）：若组顺序确定但组内
 * 随输入顺序变，`JSON.stringify` 结果就不同 ⇒ 同一份诊断两次渲染出不同 DOM，
 * 一切「按结果判等」的守卫都会假绿。**pointer 是稳定的天然键**（无 pointer 的
 * 全局诊断排在最后、同pointer 组内再按 code 排，仍是确定的）。
 *
 * **折叠不是「一律折」**：`error` 组**永不默认折叠**（错误被藏起来 = 仪表盘失效）；
 * 只有 `warning` 组在条数 > 1 时可默认折叠，且**只对每组第一条生效**（其余由用户手动控制）。
 */

import type { Diagnostic, DiagnosticSeverity } from "../contracts";

/** 严重度排序权重（数字小 = 靠前） */
const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
};

/** 诊断码的中文标签（面板组头显示；**未知码如实回显原码**，不编造也不隐藏） */
const CODE_LABELS: Readonly<Record<string, string>> = {
  "unknown-op": "未知命令",
  "unknown-field": "未知字段",
  "missing-required": "缺必填字段",
  "invalid-value": "值不合法",
  "duplicate-column": "列 id 重复",
  "missing-target": "跳转目标缺失",
  "unknown-function": "函数不存在",
  "undefined-variable": "未定义变量",
  "missing-resource": "资源不存在",
  "missing-entry": "入口列缺失",
  "invalid-structure": "结构不合法",
  "unused-translation": "未使用的译文键",
  "missing-translation": "缺译文",
  "invalid-element": "元素不合法",
  "unimplemented-element-attr": "元素属性未实现",
};

/** 组头显示的标签（未知码 ⇒ 原样回显，**不吞信息**） */
export function diagnosticCodeLabel(code: string): string {
  return CODE_LABELS[code] ?? code;
}

/** 一个诊断分组 */
export interface DiagnosticGroup {
  /** 诊断码（同组同码） */
  readonly code: string;
  /** 组头标签（中文；未知码为原码） */
  readonly label: string;
  /** 该组最严重的严重度（组内可能混档，取最高） */
  readonly severity: DiagnosticSeverity;
  /** 组内条目（**按 pointer 稳定排序**——确定性，见文件头排序规则） */
  readonly items: readonly Diagnostic[];
  /** **是否建议默认折叠**（`error` 组恒 `false`） */
  readonly collapsedByDefault: boolean;
}

/** 分组判据。空输入 ⇒ 空数组（空态由视图表达，不塞占位组） */
export function groupDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly DiagnosticGroup[] {
  const buckets = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const bucket = buckets.get(d.code);
    if (bucket === undefined) buckets.set(d.code, [d]);
    else bucket.push(d);
  }
  const groups: DiagnosticGroup[] = [];
  for (const [code, items] of buckets) {
    // 组严重度 = 取最高（error > warning）——同组可能混档
    const severity: DiagnosticSeverity =
      items.some((d) => d.severity === "error") ? "error" : "warning";
    groups.push({
      code,
      label: diagnosticCodeLabel(code),
      severity,
      // 组内排序：pointer 非空优先（可定位的排前面），再按 pointer 码元序。
      // 空 pointer = 全局诊断，天然沉底。
      items: [...items].sort(compareItems),
      // error 组永不默认折叠；warning 组多条时才建议折（单条折了没意义且更烦）
      collapsedByDefault: severity !== "error" && items.length > 1,
    });
  }
  return groups.sort(compareGroups);
}

/** 组内比较：有 pointer 优先 → pointer 码元序 → message 码元序（**全序，确定性**） */
function compareItems(a: Diagnostic, b: Diagnostic): number {
  if ((a.pointer === "") !== (b.pointer === "")) return a.pointer === "" ? 1 : -1;
  if (a.pointer !== b.pointer) return a.pointer < b.pointer ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/** 组间比较：严重度 → 条数降序 → code 码元序（**确定性**，不抖） */
function compareGroups(a: DiagnosticGroup, b: DiagnosticGroup): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.items.length !== b.items.length) return b.items.length - a.items.length;
  return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
}

/** 面板顶部汇总文案（**不逐条罗列**——那正是淹没的来源）：`3 条 · 2 类 · 1 个错误` */
export interface DiagnosticSummary {
  readonly total: number;
  readonly kinds: number;
  readonly errors: number;
  readonly warnings: number;
}

export function summarizeDiagnostics(groups: readonly DiagnosticGroup[]): DiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  for (const g of groups) {
    for (const d of g.items) {
      if (d.severity === "error") errors += 1;
      else warnings += 1;
    }
  }
  return { total: errors + warnings, kinds: groups.length, errors, warnings };
}

/** 汇总文本（**零诊断时给「无」而不是「0 条 · 0 类」**——那不是状态，是空数据的算术） */
export function diagnosticSummaryText(summary: DiagnosticSummary): string {
  if (summary.total === 0) return "无";
  const parts: string[] = [];
  if (summary.errors > 0) parts.push(`${summary.errors} 个错误`);
  if (summary.warnings > 0) parts.push(`${summary.warnings} 个警告`);
  return `${summary.total} 条 · ${parts.join(" · ")}`;
}

/**
 * 严重度筛选（**null = 全部**）。
 *
 * 为什么进纯函数：徽章「可点筛选」的语义只有一条——按 severity 等值过滤、
 * **不重排不改写**（排序仍归 `groupDiagnostics`）。放这里组件就没有机会
 * 在筛选时顺手夹带别的规则（比如把全局诊断滤掉），两处口径永不漂移。
 */
export type SeverityFilter = "error" | "warning" | null;

export function filterDiagnosticsBySeverity(
  diagnostics: readonly Diagnostic[],
  filter: SeverityFilter,
): readonly Diagnostic[] {
  if (filter === null) return diagnostics;
  return diagnostics.filter((d) => d.severity === filter);
}

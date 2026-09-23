/**
 * 06-D6 诊断契约：编辑期诊断统一形态，pointer = RFC 6901 JSON Pointer（指向 Story 树）。
 * 锚点: diagnostics-with-pointer
 */

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  /** 诊断码：unknown-op / unknown-field / missing-required / invalid-value / duplicate-column / missing-target / unknown-function / undefined-variable / missing-resource / missing-entry / invalid-structure / unused-translation */
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** RFC 6901 JSON Pointer，指向 Story 树内位置（如 /columns/0/commands/3/text） */
  pointer: string;
  /** 涉及的 op（结构诊断时附带） */
  op?: string;
}

/** 转义 JSON Pointer 单段（RFC 6901：~ → ~0，/ → ~1） */
export function escapePointerToken(token: string | number): string {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

/** 由段序列组装 JSON Pointer（空段 = 根 ""） */
export function joinPointer(...segments: (string | number)[]): string {
  if (segments.length === 0) return "";
  return "/" + segments.map(escapePointerToken).join("/");
}

/** 06 §一.2 符号索引（灵泛 ProjectIndex 思路）：columnId / defines 键 / 变量 / 函数 / 跳转目标 / 资源引用 / 可翻译原文 */
export interface SymbolIndex {
  /** columnId → 首个同名列的指针（重复列另见 duplicateColumns） */
  columnPointers: Map<string, string>;
  duplicateColumns: { id: string; pointer: string }[];
  entry: string;
  /** 变量定义键 → 首个定义处指针（含 defines / set / define / let / local / array / dict / random.var / 循环变量 / input.store） */
  definedKeys: Map<string, string>;
  /** 函数名 → 参数与定义处（func op） */
  functions: Map<string, { params: string[]; pointer: string }>;
  /** 跳转/调用目标引用（jump/menu/navigate → column；call → function） */
  targets: {
    pointer: string;
    target: string;
    kind: "column" | "function";
  }[];
  /** 资源逻辑路径引用（resource kind 字段 + say.voice） */
  resources: { pointer: string; path: string }[];
  /** 表达式/插值中的变量引用（undefined-variable 诊断与 `_` 豁免的输入） */
  variableRefs: {
    pointer: string;
    name: string;
    kind: "expression" | "interpolation";
  }[];
  /** 可翻译原文集合（say.text / menu.prompt / menu.options[].text / input.prompt / notify.text——运行时四处 Translate 挂接） */
  originals: Set<string>;
}

/** analyzeStory 可选供给侧数据：缺省时对应诊断族跳过（不误报） */
export interface AnalyzeOptions {
  /** 资源根内实际文件集合（相对 Resources/ 的逻辑路径）→ 资源路径缺失诊断 */
  resourceFiles?: ReadonlySet<string>;
  /** overlay 译文键集合（Lang/{lang} 合并后）→ 未使用翻译键诊断（06 §一.2 翻译缺口检查器） */
  overlayKeys?: ReadonlySet<string>;
}

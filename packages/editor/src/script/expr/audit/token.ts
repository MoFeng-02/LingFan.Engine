/**
 * 判类器使用的词法词汇：装配层产出的 token 流，与「结构不认识」的中止信号。
 *
 * `OperandKind` 是判类结果（三种变量种类 + 未知）；注册表侧的两个类型在此转出，
 * 判类器的实现文件便只需一条导入。
 */

import type { ExpressionWarning, VarKind } from "../registry";

export type { ExpressionWarning, VarKind };

export type OperandKind = VarKind | "unknown";

export type AuditToken =
  | {
      readonly t: "operand";
      readonly kind: OperandKind;
      readonly label: string;
    }
  | { readonly t: "op"; readonly text: string }
  | { readonly t: "punct"; readonly text: string };

export const BAIL = Symbol("audit-bail");

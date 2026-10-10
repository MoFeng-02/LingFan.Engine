/**
 * 审计子模块出口：判类器与它使用的词法词汇。
 *
 * 装配层只从这里取，不引子模块内部文件。
 */

export { ExpressionAuditor } from "./parser";
export { type AuditToken, type OperandKind } from "./token";

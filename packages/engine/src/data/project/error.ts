/**
 * 工程文件的整次拒绝错误：issues 逐条说明不符之处。
 * 组装（读向）与写回（写向）各有一支，调用方只需认这两个类。
 */
export class ProjectAssemblyError extends Error {
  /** 全部失败原因，逐条说明是哪个文件/哪个字段不符；调用方可原样展示 */
  readonly issues: string[];

  /** 把 issues 汇总成一条多行 message 挂到 `Error.message`，`name` 固定为 `ProjectAssemblyError` */
  constructor(issues: string[]) {
    super(`工程组装失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "ProjectAssemblyError";
    this.issues = issues;
  }
}

/**
 * 工程写回失败（整次拒绝）。
 */
export class ProjectSerializationError extends Error {
  /** 全部写回失败原因（列 id 冲突、形状非法、路径不可用等）；调用方可原样展示 */
  readonly issues: string[];

  /** 把 issues 汇总成一条多行 message 挂到 `Error.message`，`name` 固定为 `ProjectSerializationError` */
  constructor(issues: string[]) {
    super(`工程写回失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "ProjectSerializationError";
    this.issues = issues;
  }
}

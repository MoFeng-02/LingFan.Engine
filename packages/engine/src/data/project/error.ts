/**
 * 工程文件的整次拒绝错误：issues 逐条说明不符之处。
 * 组装（读向）与写回（写向）各有一支，调用方只需认这两个类。
 */
export class ProjectAssemblyError extends Error {
  readonly issues: string[];

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
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`工程写回失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "ProjectSerializationError";
    this.issues = issues;
  }
}

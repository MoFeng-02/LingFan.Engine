/**
 * 故事 JSON 校验失败：整次拒绝，issues 带来源定位。
 * 读向与写向共用同一个错误类型，调用方只需认这一个类。
 */
export class StoryFormatError extends Error {
  /** 全部失败原因，逐条带源定位（`文件名:行号` 或 `列 id.字段`）；调用方可原样展示 */
  readonly issues: string[];

  /** 把 issues 汇总成一条多行 message 挂到 `Error.message`，`name` 固定为 `StoryFormatError` */
  constructor(issues: string[]) {
    super(`故事 JSON 解析失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "StoryFormatError";
    this.issues = issues;
  }
}

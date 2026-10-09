/**
 * 故事 JSON 校验失败：整次拒绝，issues 带来源定位。
 * 读向与写向共用同一个错误类型，调用方只需认这一个类。
 */
export class StoryFormatError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`故事 JSON 解析失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "StoryFormatError";
    this.issues = issues;
  }
}

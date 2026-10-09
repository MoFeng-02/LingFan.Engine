/**
 * 文本投影失败：整次拒绝，并带上全部定位信息。
 * 读向与写向共用同一个错误类型，调用方只需认这一个类。
 */
export class TextFormatError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`文本投影失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "TextFormatError";
    this.issues = issues;
  }
}

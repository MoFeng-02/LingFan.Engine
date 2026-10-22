/**
 * 文本投影失败：整次拒绝，并带上全部定位信息。
 * 读向与写向共用同一个错误类型，调用方只需认这一个类。
 */
import { defaultEngineTexts, type EngineTexts } from "../../contracts/index.ts";

export class TextFormatError extends Error {
  /** 全部失败原因，逐条带源定位（`文件名:行号` 或列 id + 字段路径）；调用方可原样展示 */
  readonly issues: string[];

  /** 把 issues 汇总成一条多行 message 挂到 `Error.message`，`name` 固定为 `TextFormatError` */
  constructor(issues: string[], texts: EngineTexts = defaultEngineTexts) {
    super(texts.textFormat(issues));
    this.name = "TextFormatError";
    this.issues = issues;
  }
}

/** cell 声明提取失败（带 `origin` 定位：`相对路径:行`）——由调用方决定是否中断构建 */
export class CellExtractError extends Error {
  /** 文案拼装：定位前置成「`相对路径:行` —— 消息」，日志一眼看到出处。 */
  constructor(
    message: string,
    readonly origin: string,
  ) {
    super(`${origin} —— ${message}`);
    this.name = "CellExtractError";
  }
}

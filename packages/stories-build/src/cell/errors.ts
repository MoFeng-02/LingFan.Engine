/** cell 声明提取失败（带 `origin` 定位：`相对路径:行`）——由调用方决定是否中断构建 */
export class CellExtractError extends Error {
  /** 定位：`相对路径:行`，由构造参数赋值 */
  readonly origin: string;

  /** 文案拼装：定位前置成「`相对路径:行` —— 消息」，日志一眼看到出处。 */
  constructor(message: string, origin: string) {
    super(`${origin} —— ${message}`);
    this.origin = origin;
    this.name = "CellExtractError";
  }
}

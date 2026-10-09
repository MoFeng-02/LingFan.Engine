/**
 * 写向投影的上下文：缩进前缀与输出缓冲（外加扩展投影表），
 * 由 `generateCommand` 一次性交给各 op 族文件。
 */
import type { CustomOpProjections } from "../../../contracts";

/**
 * 写向投影的行上下文：由 `generateCommand` 建一次、按族函数传给各 op 族。
 */
export interface GenerateContext {
  /** 本行的缩进前缀；块体每深一层加两空格 */
  pad: string;
  /** 输出缓冲，投影出的整行按序推入，不带换行符 */
  out: string[];
  /** 自定义 op 的文本投影表；缺省表示没有扩展投影，命中时回落到整次拒绝 */
  projections?: CustomOpProjections;
}

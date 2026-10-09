/**
 * 写向投影的上下文：缩进前缀与输出缓冲（外加扩展投影表），
 * 由 `generateCommand` 一次性交给各 op 族文件。
 */
import type { CustomOpProjections } from "../../../contracts";

export interface GenerateContext {
  pad: string;
  out: string[];
  projections?: CustomOpProjections;
}

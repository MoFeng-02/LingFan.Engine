/**
 * 文本投影契约：故事数据 → `.story` 文本。
 *
 * 投影是**容错**的：能生成的照常输出，生成不了的（未知 op）收进 `issues` 报告，
 * 而不是整次失败——编辑器文本模式据此提示作者，其余内容仍可见可编辑。
 */

/** 一次投影的结果：文本本体 + 未能投影的部分（`issues` 为空即完整投影） */
export interface TextProjection {
  text: string;
  issues: string[];
}

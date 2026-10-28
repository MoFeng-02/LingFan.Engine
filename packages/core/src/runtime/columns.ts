/**
 * 列清单投影：故事定义 → 宿主可读的只读摘要。
 *
 * **为什么要这一层而不是让宿主读 `story.columns`**：宿主一旦拿到整份 `StoryColumn`，
 * 就能拿到 `commands` / `elements` / `entry`——那是引擎的解释输入。宿主自己解释一遍
 * 命令流，等于在引擎之外再造一套解释器，两套必然漂移。这里只交出宿主真正用得上的
 * 三件事：列 id、归一后的类型、内容形态。
 *
 * **写时复制**：每次调用都新建数组与对象并冻结。摘要一旦可写，宿主改一个 `type`
 * 就会让「引擎认为的列类型」和「宿主认为的」分叉，而引擎那边毫不知情。
 * 冻结把这种改动静默变成立即报错（严格模式下赋值抛 TypeError）。
 */
import { sceneTypeOf } from "../shared/guards.ts";
import type { ColumnSummary } from "../contracts/runtime/column-summary.ts";
import type { Story } from "../contracts/story/entities.ts";

/**
 * 造一份列摘要表（顺序与 `story.columns` 一致）。
 *
 * 顺序即呈现顺序：宿主列章节时按这个次序，跳转与「下一列」也据此推断，
 * 所以**不排序、不去重**——故事里的顺序就是作者写的顺序。
 */
export function columnSummaries(story: Story): readonly ColumnSummary[] {
  return story.columns.map((column) =>
    Object.freeze<ColumnSummary>({
      id: column.id,
      type: sceneTypeOf(column),
      kind: column.kind,
    }),
  );
}

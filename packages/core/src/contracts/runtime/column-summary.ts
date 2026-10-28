/**
 * 列摘要：宿主看故事时能看到的那部分列信息。
 *
 * **为什么只给这三个字段**：宿主需要的是「有哪些列、各是什么类型、当前在哪列」——
 * 用来列章节、判当前页、决定跳哪。列里的 `commands` / `elements` / `entry` 归引擎，
 * 宿主拿到它们只会诱使自己绕过引擎去解释命令流（两套解释器必然漂移）。
 *
 * **只读**：字段全部 `readonly`，且引擎给出的实例是冻结的——摘要是引擎状态的镜像，
 * 不是可写副本。要改列内容走故事文件与热重载，不从这里改。
 *
 * 与 `StoryColumn` 的关系：这是它的**投影**，不是精简版故事树。`type` 在这里是
 * 归一后的值（缺省 `game`），宿主因此不必自己处理「没写 type 算哪种」。
 */
import type { SceneType } from "../story/index.ts";

/** 单列的只读摘要：id、归一后的运行语义类型、内容形态 */
export interface ColumnSummary {
  /** 列 id（故事内唯一；跳转与当前列判定都用它） */
  readonly id: string;
  /** 运行语义类型（**已归一**：`type` 缺省或非法时取 `game`） */
  readonly type: SceneType;
  /** 内容形态：`scene` = 空间层（元素 + 入口命令）/ `flow` = 纯流程 */
  readonly kind: "scene" | "flow";
}

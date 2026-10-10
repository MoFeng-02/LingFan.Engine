/**
 * 作者视图落地器（构建期共享模块）。
 *
 * `列草稿` 是列的作者视图（比手写 JSON 形状舒服的中间抽象）；`建列` 把草稿落成引擎
 * 契约 StoryColumn——全库**唯一**碰底层形状的地方（fail-closed：kind 未知直接抛）。
 * `重复` 是构建期重复结构生成器（泛型 + while，运行期零循环）。
 *
 * 为什么不是「故事源」：源约定 = `Stories.src/` 顶层恰好一个 `.ts`（default 导出
 * Story）；本文件在 `lib/` 子目录 ⇒ 被 `story.ts` 经出口复用，不参与源计数。
 */
import type { ElementNode, StoryColumn, StoryCommand } from "@lingfan/engine";

/** 列的作者视图：作者只说 id / kind / 命令|元素，底层 StoryColumn 形状由 建列 收口。 */
export interface 列草稿 {
  id: string;
  kind: "flow" | "scene";
  /**
   * **布局声明**（构建期配置）：这列住在哪个故事文件——
   * 章节目录（`Stories/chapter1/chapter1.story`）+ 同文件多列自动成组；
   * 扩展名 `.story` / `.json` 随声明。不声明 = 平铺默认 `Stories/<id>.json`（平铺形态已被否决）。
   */
  sourcePath?: string;
  /** flow 列：按时间轴推进的命令流 */
  命令?: StoryCommand[];
  /** scene 列：声明式空间层 */
  元素?: ElementNode[];
  /** scene 列：点击后执行的入口命令流 */
  入口?: StoryCommand[];
}

/** 列草稿 → 引擎契约（唯一一处碰底层形状；fail-closed：kind 未知直接抛） */
export function 建列(草稿: 列草稿): StoryColumn {
  const 定位 = 草稿.sourcePath === undefined ? {} : { sourcePath: 草稿.sourcePath };
  if (草稿.kind === "scene") {
    return {
      id: 草稿.id,
      kind: "scene",
      elements: 草稿.元素 ?? [],
      ...(草稿.入口 !== undefined ? { entry: 草稿.入口 } : {}),
      ...定位,
    };
  }
  if (草稿.kind === "flow") {
    return { id: 草稿.id, kind: "flow", commands: 草稿.命令 ?? [], ...定位 };
  }
  throw new Error(`未知列类型：${String((草稿 as { kind?: unknown }).kind)}`);
}

/** 重复结构生成器：泛型 + while 构建期展开，运行期零循环；序号从 0 起。 */
export function 重复<T>(次数: number, 生成: (序号: number) => T): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < 次数) {
    out.push(生成(i));
    i += 1;
  }
  return out;
}

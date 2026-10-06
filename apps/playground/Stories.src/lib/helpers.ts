/**
 * TS 故事源 · **函数注入示范库**（构建期共享模块）。
 *
 * 为什么它不是「故事源」：源约定 = `Stories.src/` **顶层**恰好一个 `.ts`（default 导出
 * Story）；本文件在 `lib/` 子目录 ⇒ 被 `story.ts` import 复用，不参与源计数。
 *
 * 本文件演示「TS 全能力里属于构建期的部分」——类型 / 枚举 / 接口 / 泛型 / 递归
 * 随便用，唯一要求：`story.ts` 的 default 导出值是**合法 Story 数据**（与 JSON 同一
 * `parseStory` 校验，零第二套规则）。这里集中「作者词汇表」：底层 StoryColumn /
 * StoryCommand 的形状知识只出现在构建器里，故事源只说人话。
 */
import type { ElementNode, StoryColumn, StoryCommand } from "@lingfan/engine";

// —— enum：构建期常量（运行期不存在——产物只有展开后的数据） ——
export enum 地点 {
  酒馆 = "inn",
  广场 = "square",
  元素舞台 = "stage_demo",
  TS能力 = "ts_power",
}

// —— as const 常量表 + 索引类型（人物名只允许表中取值） ——
export const 人物 = {
  灵泛: "灵泛",
  老板: "酒馆老板",
  旁白: "旁白",
  系统: "系统",
} as const;
export type 人物名 = (typeof 人物)[keyof typeof 人物];

// —— interface：列草稿的作者视图（比手写 JSON 形状舒服的中间抽象） ——
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

// —— 命令快捷词（作者词汇表的核心收益：say/menu/jump 一行一个） ——
export const 说 = (文本: string, 说话人?: 人物名): StoryCommand => ({
  op: "say",
  text: 文本,
  ...(说话人 === undefined ? {} : { speaker: 说话人 }),
});

export const 跳到 = (列: string): StoryCommand => ({ op: "jump", target: 列 });

/** 菜单：选项用元组数组（[显示文本, 目标列]），构建期即可由枚举生成 */
export const 菜单 = (
  提示: string,
  选项: ReadonlyArray<readonly [string, string]>,
): StoryCommand => ({
  op: "menu",
  prompt: 提示,
  options: 选项.map(([text, target]) => ({ text, target })),
});

// —— 泛型 + while：重复结构生成器（构建期展开，运行期零循环） ——
export function 重复<T>(次数: number, 生成: (序号: number) => T): T[] {
  const out: T[] = [];
  let i = 0;
  while (i < 次数) {
    out.push(生成(i));
    i += 1;
  }
  return out;
}

// —— 递归：容器元素树（panel → children 任意深度，坐标相对容器） ——
export interface 元素配置 {
  id?: string;
  x?: string | number;
  y?: string | number;
  width?: string | number;
  color?: string;
  size?: number;
  [attr: string]: unknown;
}

export function 文本元素(text: string, 配置: 元素配置 = {}): ElementNode {
  return { type: "text", text, ...配置 };
}

export function 面板(配置: 元素配置, 子元素: ElementNode[]): ElementNode {
  return { type: "panel", children: 子元素, ...配置 };
}

/**
 * 故事源 · 唯一顶层源文件（源约定：本目录顶层**恰好一个** .ts，default 导出多列 Story）。
 *
 * 分层（词汇单点注入，其余各司其职）：
 * - lib/vocabulary —— script 词汇与 vars 注册的唯一定义处；
 * - lib/cells —— 运行期守卫的具名实现槽位（构建期扫描进 gen/fun_register.g.ts）；
 * - lib/language-showcase —— 列草稿/建列 作者视图与生成器示范；
 * - lib/chapters / lib/vocab-tour —— 第一至三章主线与第四章全席的内容列；
 * - lib/index —— lib 子域唯一出口。
 *
 * 本文件只做装配与构建期自检：TS 原生 if / Set = 构建期分支（fail-fast），
 * 运行期语义全部由列内 op 承载。
 */
import type { Story, StoryColumn } from "@lingfan/engine";
import {
  包含教学列,
  开场列,
  酒馆列,
  广场列,
  舞台列,
  教学列,
  尾声列,
  全席列,
  变量站,
  流程站,
  存档站,
  声光站,
  舞台站,
  扩展站,
  守卫站,
} from "./lib";
import { vars, checkGold, tourOpen } from "./lib";

// 出口转发：vars（插值键全集）与 cell 实现（fun_register.g.ts 的源），定义见 lib/ 子域
export { vars, checkGold, tourOpen };

/** 列草稿集：全库列的装配清单——主线三章 + 条件性教学列 + 第四章八列，顺序即产物列序。 */
const 列草稿集: StoryColumn[] = [
  开场列,
  酒馆列,
  广场列,
  舞台列,
  ...(包含教学列 ? [教学列] : []),
  尾声列,
  全席列,
  变量站,
  流程站,
  存档站,
  声光站,
  舞台站,
  扩展站,
  守卫站,
];
/** 列 id 唯一性自检：重复即构建失败（parseStory 之前 fail-fast）。 */
const 列id集 = new Set(列草稿集.map((草稿) => 草稿.id));
if (列id集.size !== 列草稿集.length) {
  throw new Error("构建期自检失败：列 id 重复");
}
/** 入口列 id：故事从这里开始推进；不在列草稿集里即构建失败。 */
const 入口id = "start";
if (!列id集.has(入口id)) {
  throw new Error(`构建期自检失败：入口列 ${入口id} 不存在`);
}

/** 演示故事的唯一出口：formatVersion / id / entry / defines + 列草稿集；satisfies Story 保证形状契约。 */
export default {
  formatVersion: 1,
  id: "demo",
  entry: 入口id,
  // defines 要写全：缺键会在 serialize 时被抹掉（player.gold 初始 7 是演示的前提）
  defines: { "player.gold": 7 },
  columns: 列草稿集,
} satisfies Story;

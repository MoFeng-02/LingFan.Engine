/**
 * 故事章节树 · **纯判据**（可测，无 IO / 无 Vue）。
 *
 * 存在理由：左栏原按「资源种类」平铺，但工程实践揭示了**另一个骨架**——
 * `Stories/` 与 `Lang/` 常**按章节分目录**
 * （`chapter1/chapter1.story`、`Lang/en-US/chapter1/chapter1.json`），
 * 且 `Lang/` 有**三种布局并存**（en 平铺 / en-US 子目录分类 / ja 单文件）。
 * ⇒ **内容骨架是「章节」，不是文件**；文件怎么摆是**作者的自由**。
 *
 * **任意深度递归，不写死「一级 = 章节」**：常见工程恰好只到 1 层
 * （`Stories/chapter1/chapter1.story`），也有 0 层平铺
 * （`Stories/start.json`）；而 `Lang/en-US/system/about.json` 已到 2 层
 * ⇒ 按层数写死会错。
 * 0 层平铺工程退化为「无章节分组的全平铺列表」，**不报错**。
 *
 * 域出口：本文件**只做转发**（类型声明见 `./types`、判据与装配实现见 `./build`）。
 * 类型单独成文件是为了断开「出口 ⇄ 实现」的 import 环（§3.5）。
 */

export {
  buildChapterIndex,
  chapterDirOf,
  chapterGroupOf,
  chapterLabelOf,
  chapterSummaryText,
  sceneTypeBadgeOf,
} from "./build.ts";

export type {
  ChapterDir,
  ChapterGroup,
  ChapterIndex,
  ChapterInput,
  ChapterNode,
} from "./types.ts";

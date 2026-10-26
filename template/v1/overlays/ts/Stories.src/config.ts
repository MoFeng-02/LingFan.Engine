/**
 * 故事源配置：**整条 TS 创作链唯一的声明点**。
 *
 * 构建器只认这个文件：`folders` 说明哪些目录参与编译（相对本文件所在目录），
 * `start` 说明入口故事是哪个文件（写文件名、含扩展名，全工程恰好一个）。
 * 不在这里列出的目录会被当作草稿忽略——扫描整个目录会让「临时存个文件」
 * 变成静默进产物，作者应该显式决定哪些目录算数。
 *
 * `vars` 声明插值键的取值类型（键名进类型检查，值只用于校验与编辑器提示）。
 * 需要跨列共享的初始状态用 `define("player.gold", 100)` 声明，本工程示例没有用到。
 */
import type {} from "@lingfan-engine/stories-build/authoring";

export default {
  folders: ["title"],
  start: "title_main.ts",
  vars: defineVars({ name: "string" }),
} satisfies StoriesConfig;

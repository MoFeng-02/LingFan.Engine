/**
 * Script 词汇层 · 词条实现（作者可用的 builder 与选项类型）。
 * 每个文件对应一族词条：叙事 / 流程 / 变量 / 存档 / 音频 / 视频 / 小游戏 /
 * 元素 / 复合词 / 扩展 / 具名实现槽位 / 交互。
 * 各文件导出名互不重复，故此处整体转发；对外仍由 `script` 出口按族列出名单。
 *
 * 每个词条函数都是**纯数据构造**：只返回一条 `StoryCommand`（与 JSON 同族），
 * 不执行任何副作用——真正的画面/状态效果发生在引擎运行这条命令时。
 * 条目级 JSDoc 以「作者视角」描述调用后玩家看到什么、状态怎么变。
 */
export * from "./audio.ts";
export * from "./cells.ts";
export * from "./compile-time.ts";
export * from "./composite.ts";
export * from "./elements.ts";
export * from "./extension.ts";
export * from "./flow.ts";
export * from "./interaction.ts";
export * from "./minigame.ts";
export * from "./narrative.ts";
export * from "./save.ts";
export * from "./vars.ts";
export * from "./video.ts";

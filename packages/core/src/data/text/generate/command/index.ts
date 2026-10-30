/**
 * 命令文本生成族出口：按命令族分片的生成器。
 *
 * 轴 = 命令族（块体 / 集合 / 对话 / 流程 / 媒体 / 表演 / 存档 / UI / 变量）。缩进与投影器由
 * 调用方注入，族文件只认自己那族的字段。
 */
export { generateBlocksCommand } from "./blocks.ts";
export { generateCollectionsCommand } from "./collections.ts";
export { generateDialogCommand } from "./dialog.ts";
export { generateFlowCommand } from "./flow.ts";
export { generateMediaCommand } from "./media.ts";
export { generatePresentCommand } from "./present.ts";
export { generateSaveCommand } from "./save.ts";
export { generateUiCommand } from "./ui.ts";
export { generateVariablesCommand } from "./variables.ts";

/**
 * 语句解析族出口：按命令族分片的语句解析器。
 *
 * 轴 = 命令族（集合 / 对话 / 流程 / 媒体 / 表演 / 存档 / UI / 变量），每片只认自己那族的关键字。
 */
export { parseCollectionsStatement } from "./collections.ts";
export { parseDialogStatement } from "./dialog.ts";
export { parseFlowStatement } from "./flow.ts";
export { parseMediaStatement } from "./media.ts";
export { parsePresentStatement } from "./present.ts";
export { parseSaveStatement } from "./save.ts";
export { parseUiStatement } from "./ui.ts";
export { parseVariablesStatement } from "./variables.ts";

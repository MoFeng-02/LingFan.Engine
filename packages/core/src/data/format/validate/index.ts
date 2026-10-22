/**
 * 命令负载校验族出口：按命令族分片的校验器。
 *
 * 轴 = 命令族（对话 / 流程 / 变量 / 集合 / 存档 / 表演 / 块体），族内共享的形状谓词
 * （`shape.ts`）属族内细节，不进出口。
 */
export { validateBlocksCommand } from "./blocks.ts";
export { validateCollectionsCommand } from "./collections.ts";
export { validateDialogCommand } from "./dialog.ts";
export { validateFlowCommand } from "./flow.ts";
export { validatePresentCommand } from "./present.ts";
export { validateSaveCommand } from "./save.ts";
export { validateVariablesCommand } from "./variables.ts";

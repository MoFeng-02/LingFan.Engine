/**
 * 存档子层出口：存档导出、读档导入与扩展依赖编排。
 *
 * 执行器与运行层内部模块从这里取存档成员；子层各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。
 */
export { exportSave } from "./export";
export { importSave } from "./import";
export {
  resolveSaveExtensions,
  restoreSaveExtensions,
  tryMigrateSave,
} from "./extensions";

/**
 * 状态子层出口：写入通道、实例 z、表达式求值、出站面与状态读口。
 *
 * 执行器与运行层内部模块从这里取状态相关成员；子层各文件之间仍按需直接引用。
 * 这里只做转发，不放任何实现。
 */
export { setGlobal, setSilentKey, setSystem, writeExternal } from "./writer";
export { rejectBadInstanceZ, setInstanceZ } from "./instance-z";
export { evalValue, readVariable, resolveName } from "./evaluate";
export { emitChange, emitErrorEvent, publishEvent } from "./notify";
export { createStateReader } from "./reader";

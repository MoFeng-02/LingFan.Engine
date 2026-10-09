/** 写回子域出口：权限判定 + 单文件读写 + 指纹采集 + 工程写入编排 */
export { ensureReadAccess, ensureWriteAccess } from "./access";
export { createHandleProjectWriter } from "./apply";

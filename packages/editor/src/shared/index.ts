/**
 * 共享层出口：没有业务含义、任何域都可以引用的取值判据与小工具。
 * 实现按用途分文件，域外消费方只从这里取。
 */
export { escapePointerToken, joinPointer } from "./pointer";
export { isPlainObject } from "./guards";

/**
 * 通用出口：没有业务含义的取值判据与小工具，不依赖包内其他层，任何层都可以引用。
 * 实现按用途分文件，消费方只从这里取。
 */
export * from "./guards.ts";
export * from "./numbers.ts";

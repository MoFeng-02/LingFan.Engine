/**
 * 存档域出口：只放「读存档摘要之后怎么用」的纯逻辑，不碰 `SavePort` 实现。
 *
 * 端口实现（localStorage / Rust 命令 / 别的）在各平台适配器里；这里回答的是
 * 与平台无关的问题——「哪一槽是最近写入的、宿主入口该不该可点」。
 */
export { continueSlot, latestSave } from "./continue.ts";

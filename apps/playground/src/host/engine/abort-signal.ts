/**
 * 中止句柄收窄：与模板共用 `@lingfan-engine/ui` 一份实现，本文件只做转发。
 * 契约层只承诺 `signal.aborted` 可轮询；浏览器宿主收窄回 `AbortSignal` 订阅中止事件。
 */
export { abortSignalOf } from "@lingfan-engine/ui";

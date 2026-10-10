/**
 * 渲染诊断探针（build-flag 开关：`VITE_LFEN_DIAG=1` 构建时进产物并自启；
 * 默认构建 tree-shake 零字节）。
 *
 * 用途：定位「应用跑得起来但画面空白」类问题（白屏取证）——采集渲染层栈
 * （z-index/矩形/可见性）、#app 规模与背景、媒体元素状态（readyState/error/矩形），
 * 并在每次采样时给出白屏归因结论（见 `./classify.ts`）。
 * 浏览器形态（无 Tauri IPC）静默跳过上报，采样逻辑照常执行。
 *
 * 布局：`classify.ts` 归因纯函数 · `probe.ts` 采样载荷 · `report.ts` IPC 上报端口 ·
 * `boot.ts` 启动节奏。对外只导出 `startDiag` 与归因三件套。
 */
export { startDiag } from "./boot";
export {
  classifyWhiteScreen,
  type WhiteScreenClass,
  type WhiteScreenEvidence,
} from "./classify";

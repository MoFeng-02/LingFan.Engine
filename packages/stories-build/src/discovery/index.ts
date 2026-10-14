/**
 * 源发现域：把 `Stories.src` 按 folders 声明扫成待编译清单。
 *
 * 这一域只负责「哪些文件算数、入口是哪个、有没有漏登记的 default 导出」，
 * 不碰编译也不碰写盘——那些在各目的域里。
 */
export { discoverSources, type DiscoveredSources } from "./source-discovery.ts";

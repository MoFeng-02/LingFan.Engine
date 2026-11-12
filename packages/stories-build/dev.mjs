/**
 * `@lingfan-engine/stories-build/dev` 的 Node 装载垫片。
 *
 * 为什么需要它：与 `@lingfan-engine/stories-build/host-plugins` 同一个理由——
 * 本包以 TypeScript 源码出口，而 Node 的类型擦除**拒绝加载 node_modules 里的 .ts**
 * （ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。这个子路径的消费方恰恰是
 * **Node 直接执行的开发脚本**（`scripts/dev.mjs`），它们不在浏览器里，
 * Node 的类型擦除照常生效——脚手架生成的工程装到 node_modules 后必崩在这一步。
 *
 * 垫片用本包自带依赖 `tsx` 装载真实实现，扫描与解析逻辑仍然只有一份：
 * 引擎侧看到的是同一份 `src/dev/**`，没有第二份实现。
 *
 * 类型不走这里：`package.json` 的 `exports` 对该子路径用条件导出，
 * `types` 条件仍指向 `./src/dev/index.ts`，TypeScript 侧看到的还是源码声明。
 */
import { tsImport } from "tsx/esm/api";

const mod = await tsImport("./src/dev/index.ts", import.meta.url);

export const DEV_HELP_TEXT = mod.DEV_HELP_TEXT;
export const STORY_NAME_FLAG = mod.STORY_NAME_FLAG;
export const listDevEntries = mod.listDevEntries;
export const parseDevArgs = mod.parseDevArgs;
export const resolveDevTarget = mod.resolveDevTarget;
export const runDevCommand = mod.runDevCommand;

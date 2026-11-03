/**
 * `@lingfan-engine/stories-build/host-plugins` 的 Node 装载垫片。
 *
 * 为什么需要它：本包以 TypeScript 源码出口，而 Node 的类型擦除**拒绝加载
 * node_modules 里的 .ts**（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。这个子路径
 * 的消费方恰好是 **Node 直接加载的构建配置**（`vite.config.ts` 经 `vite.plugins.ts`
 * 引它），而 vite 默认的配置加载器会把依赖外置成真实的 ESM import——于是配置一加载
 * 就崩在 .ts 上。垫片用本包自带依赖 `tsx` 装载真实实现，扫描逻辑仍然只有一份。
 *
 * 类型不走这里：`package.json` 的 `exports` 对该子路径用条件导出，`types` 条件仍指向
 * `./src/host-plugins/index.ts`，TypeScript 侧看到的还是源码声明。
 */
import { tsImport } from "tsx/esm/api";

const mod = await tsImport("./src/host-plugins/index.ts", import.meta.url);

export const STORY_FONTS_MODULE_ID = mod.STORY_FONTS_MODULE_ID;
export const STORY_LIST_MODULE_ID = mod.STORY_LIST_MODULE_ID;
export const storyFontsVirtual = mod.storyFontsVirtual;
export const storyListVirtual = mod.storyListVirtual;

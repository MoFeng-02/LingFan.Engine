#!/usr/bin/env node
/**
 * `lingfan-stories-watch` 可执行入口（bin 垫片，Node 直接执行）。
 *
 * 与 `stories-build.mjs` 同一层理由：本包以 TypeScript 源码出口，而 Node 的类型擦除拒绝
 * 加载 node_modules 里的 .ts；垫片用本包自带依赖 `tsx` 装载真实 CLI，转调 `startWatchCli`。
 *
 * 用法：`lingfan-stories-watch [工程根]`；缺省工程根 = 工作目录（可由 DSH_STORIES_ROOT 覆盖）。
 */
import { tsImport } from "tsx/esm/api";

const { startWatchCli } = await tsImport(
  "../src/cli/watch-cli.ts",
  import.meta.url,
);
await startWatchCli(process.argv.slice(2));

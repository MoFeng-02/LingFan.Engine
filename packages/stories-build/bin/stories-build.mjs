#!/usr/bin/env node
/**
 * `lingfan-stories-build` 可执行入口（bin 垫片，Node 直接执行）。
 *
 * 为什么需要这层垫片：本包以 TypeScript 源码出口（`exports` 指向 `./src/*.ts`），
 * 而 Node 的类型擦除**拒绝加载 node_modules 里的 .ts**（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）
 * ——装了本包的工程既不能 `node` 直跑 `src/cli/cli.ts`，也不该被迫装一整套构建链。
 * 这层垫片用本包自带依赖 `tsx` 装载真实 CLI，转调 `runBuildCli`，呈现逻辑仍然只有一份。
 *
 * 用法：`lingfan-stories-build [工程根]`；缺省工程根 = 工作目录（可由 DSH_STORIES_ROOT 覆盖）。
 */
import { tsImport } from "tsx/esm/api";

const { runBuildCli } = await tsImport("../src/cli/cli.ts", import.meta.url);
const code = await runBuildCli(process.argv.slice(2));
if (code !== 0) process.exit(code);

#!/usr/bin/env node
/**
 * `npm create @lingfan-engine` / `pnpm create @lingfan-engine` 的可执行入口（bin 垫片）。
 *
 * 为什么需要这层垫片：本包与仓库其它包一致，以 TypeScript 源码出口（`exports` 指向
 * `./src/*.ts`）。Node 的类型擦除**拒绝加载 node_modules 里的 .ts**
 * （ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING），所以装了本包的机器既不能 `node` 直跑
 * `src/cli/cli.ts`，也不该被迫装一整套构建链。垫片用本包自带依赖 `tsx` 装载真实 CLI，
 * 呈现与编排逻辑仍然只有一份。
 *
 * 用法：`npm create @lingfan-engine [工程名] [-- --framework vanilla --shell browser]`；
 * 不带参数即进入交互问答。
 */
import { tsImport } from "tsx/esm/api";

const { runCreateCli } = await tsImport("../src/cli/cli.ts", import.meta.url);
const code = await runCreateCli(process.argv.slice(2));
if (code !== 0) process.exit(code);

#!/usr/bin/env node
// lingfan-i18n 入口垫片：用 tsx 装载 TS 入口。
// 为什么不用 Node 原生类型擦除：Node 拒绝加载 node_modules 里的 .ts
// （ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING），发布形态下本包就在 node_modules。
// 退出码由入口返回（0 成功 / 1 体检或 IO 失败 / 2 参数错误），这里只转发。
import { tsImport } from "tsx/esm/api";

const { runI18nCli } = await tsImport("../src/cli/index.ts", import.meta.url);
const code = await runI18nCli(process.argv.slice(2));
if (code !== 0) process.exit(code);

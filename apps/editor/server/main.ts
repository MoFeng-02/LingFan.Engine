/**
 * 本地服务 CLI 入口（`pnpm editor:host`，tsx 运行）。
 *
 * **开发期形态**：只起 HTTP 服务 + 打印地址与 token，供前端能力探测命中。
 * 生产期（打包形态）由同一个 `startHost` 承担，**逻辑零差异**（纯函数全在 `security.ts`）。
 *
 * 零 zod / 零框架依赖：Node 内置 `http` 足够（这是本机回环小服务，不是公网服务）。
 */
import { resolve } from "node:path";
import { startHost } from "./host";

/** 工程根 = 命令行参数（缺省当前工作目录） */
const root = resolve(process.argv[2] ?? process.cwd());

const { server, capabilities } = await startHost(root);

// 让调用方（测试 / 脚本）能读到这个地址：写进环境变量供子进程消费
process.stdout.write(
  `editor-host listening on http://127.0.0.1:${capabilities.port}\n` +
    `root: ${capabilities.root}\n` +
    `token: ${capabilities.token}\n`,
);
if (process.env.LFEN_EDITOR_HOST_INFO !== undefined) {
  process.env.LFEN_EDITOR_HOST_INFO = JSON.stringify(capabilities);
}

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

/**
 * 编辑器开发编排：**一条命令同时起「本地宿主 + 前端」**。
 *
 * 存在的理由（真实事故驱动）：编辑器的能力探测是**自动降级**的 ——
 * 宿主没起时前端**照常工作**，只是状态栏显示「浏览器」、外部打开/打包/热重载
 * 全部不可用。**这个降级太安静了**：实测中只起了 Vite 没起宿主，
 * 界面上只看到「浏览器」，唯一的线索是 Vite 终端里一行英文
 * `http proxy error … ECONNREFUSED` ⇒ 很容易被当成"功能坏了"。
 *
 * 所以这个脚本的价值不是"省一条命令"，而是**让两个进程绑在一起**：
 * 少起一个 ⇒ 前端明确告诉你"宿主没起、怎么起"，而不是安静降级。
 *
 * 零依赖（只用 Node 内置）⇒ 不引入包，也不进浏览器产物。
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_PORT = process.env.LFEN_EDITOR_HOST_PORT ?? "14250";

/** 宿主先起（前端探测依赖它）；输出前缀区分两个进程 */
// ⚠️ **必须显式传工程根**：宿主 `server/main.ts` 的缺省是 `process.cwd()`，
// 而编排脚本的 cwd 是仓库根 ⇒ 宿主会去监视/枚举**仓库根**（含 node_modules 与整个仓库）。
// 缺省取「编辑器旁边的 playground」——那是本仓的示例工程，**用户可用 `-` 覆盖**。
const projectRoot = process.argv[2] ?? join(ROOT, "apps", "playground");
const host = spawn(
  "pnpm",
  ["--filter", "@lingfan/editor-app", "host", projectRoot],
  { cwd: ROOT, shell: process.platform === "win32", env: { ...process.env, LFEN_EDITOR_HOST_PORT: HOST_PORT } },
  { stdio: ["ignore", "pipe", "pipe"] },
);
const web = spawn("pnpm", ["--filter", "@lingfan/editor-app", "dev"], {
  cwd: ROOT,
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

const tag = (name) => (chunk) => {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim() !== "") process.stdout.write(`[${name}] ${line}\n`);
  }
};
host.stdout.on("data", tag("宿主"));
host.stderr.on("data", tag("宿主"));
web.stdout.on("data", tag("前端"));
web.stderr.on("data", tag("前端"));

host.on("exit", (code) => {
  process.stdout.write(`[编排] 宿主已退出（${String(code)}）—— 前端将降级为浏览器形态\n`);
});
web.on("exit", (code) => {
  process.stdout.write(`[编排] 前端已退出（${String(code)}）\n`);
  host.kill();
  process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    host.kill();
    web.kill();
  });
}

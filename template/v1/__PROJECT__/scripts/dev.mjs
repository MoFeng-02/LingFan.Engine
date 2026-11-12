/**
 * 开发编排脚本：把「直达某列」这条意图带进开发服务器。
 *
 * 用法：`npm run dev -- --story-name inn` / `pnpm dev --story-name inn`。
 * 列 id 从编译好的故事产物里取（不是文件名）；`--list-entries` 列出全部可直达的列。
 *
 * 章节 id 不直接传给开发服务器（它不认这个选项），而是经环境变量下发，
 * 由组合根读走并交给引擎跳转。
 *
 * 零依赖（只用 Node 内置）⇒ 不引入包，也不进浏览器产物。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 本脚本所用依赖的本地路径解析器：以本脚本所在目录为基准 */
const requireFromScript = createRequire(import.meta.url);

/** 工程根目录：本脚本在 `<工程根>/scripts/` 下 */
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 章节 id 下发给开发服务器与浏览器的环境变量名 */
const ENTRY_ENV = "VITE_LFEN_ENTRY";

/**
 * 取开发服务器的可执行文件路径。
 *
 * 走包的 `package.json` 再拼 `bin/`：包的主入口是编译产物目录，
 * 从那里拼不出可执行文件的位置。
 */
function resolveViteBin() {
  const manifest = requireFromScript.resolve("vite/package.json");
  return join(dirname(manifest), "bin", "vite.js");
}

/** 把子进程输出按行加前缀转发，便于分辨是谁在说话 */
function tag(name) {
  return (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim() !== "") process.stdout.write(`[${name}] ${line}\n`);
    }
  };
}

/**
 * 装载参数解析与清单扫描。
 *
 * 该子路径要引擎包 0.4.2 及以上才有。装不上时退回「普通启动」而不是报错退出：
 * 装不上通道的工程照样要能开发，只是没有直达这一项。
 */
async function loadDevCommand() {
  try {
    const mod = await import("@lingfan-engine/stories-build/dev");
    return mod.runDevCommand;
  } catch {
    return undefined;
  }
}

/** 起开发服务器；给了章节 id 就一并下发 */
function startVite(passthrough, entryId) {
  const env = { ...process.env };
  if (entryId !== undefined) env[ENTRY_ENV] = entryId;
  const child = spawn(process.execPath, [resolveViteBin(), ...passthrough], {
    cwd: APP_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", tag("开发服务器"));
  child.stderr.on("data", tag("开发服务器"));
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      child.kill();
    });
  }
}

/** 主流程：解析参数 → 定章节 → 起开发服务器 */
async function main() {
  const argv = process.argv.slice(2);
  const runDevCommand = await loadDevCommand();
  if (runDevCommand === undefined) {
    process.stderr.write(
      "引擎包版本偏旧，这个工程用不了章节直达（需要 0.4.2 及以上）。\n" +
        "本次按普通方式启动开发服务器。\n",
    );
    startVite([], undefined);
    return;
  }
  const result = runDevCommand(argv, APP_ROOT, { foreign: "error" });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.done) {
    process.exit(result.exitCode);
  }
  startVite(result.passthrough, result.entryId);
}

await main();

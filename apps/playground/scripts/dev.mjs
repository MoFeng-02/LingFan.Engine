/**
 * 参考宿主的开发编排：把「直达某列」这条意图转成开发服务器能吃的东西。
 *
 * 为什么不直接把参数交给开发服务器：各家包管理器的透传写法不同（npm 需要 `--`，
 * pnpm 的 `--` 形态会多带一个分隔符），而开发服务器只认它自己的选项，多一个
 * 陌生选项就报错退出。与其让每个使用者记住各家写法，不如在脚本里统一收口：
 * 参数在这里解析，结论通过环境变量传给开发服务器与浏览器。
 *
 * 章节以环境变量下发（`VITE_LFEN_ENTRY`），是链路上唯一稳定的通道：它能穿过
 * 开发服务器、穿过桌面宿主的前置命令、最后落到浏览器端，中间不依赖任何一方
 * 认得章节参数。
 *
 * 零依赖（只用 Node 内置）⇒ 不引入包，也不进浏览器产物。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 开发服务器可执行文件的本地路径解析器：以本脚本所在目录为基准 */
const requireFromScript = createRequire(import.meta.url);

/** 宿主根目录：本脚本在 `apps/playground/scripts/` 下 */
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

/** 主流程：解析参数 → 定章节 → 起开发服务器 */
async function main() {
  const { runDevCommand } = await import("@lingfan-engine/stories-build/dev");
  const result = runDevCommand(process.argv.slice(2), APP_ROOT, {
    foreign: "error",
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.done) {
    process.exit(result.exitCode);
  }
  const env = { ...process.env };
  if (result.entryId !== undefined) env[ENTRY_ENV] = result.entryId;
  const child = spawn(
    process.execPath,
    [resolveViteBin(), ...result.passthrough],
    {
      cwd: APP_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
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

await main();

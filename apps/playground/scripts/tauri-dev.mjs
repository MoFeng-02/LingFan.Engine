/**
 * 桌面宿主的开发编排：把「直达某列」这条意图带进桌面开发链。
 *
 * 桌面链的前置命令会自己拉起开发服务器（它自己带构建模式），所以本脚本
 * **不再单独起一个开发服务器**——起了就抢同一个端口。章节 id 通过环境变量
 * 下发：前置命令是本进程的后代，环境会随进程树继承，值自然穿透到开发服务器，
 * 再由它注入浏览器端。
 *
 * 桌面命令只认它自己的选项，多一个陌生选项就报错退出。因此外来选项在这里
 * 统一收口：能由下游自己认的收进透传列表，其余直接报错。
 *
 * `dev` 子命令由本脚本自己补：调用方（包管理器脚本、仓根命令）若习惯带上
 * `dev`，本脚本会先摘掉它，免得它被当成章节 id。
 *
 * 零依赖（只用 Node 内置）⇒ 不引入包，也不进浏览器产物。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 桌面命令可执行文件的本地路径解析器：以本脚本所在目录为基准 */
const requireFromScript = createRequire(import.meta.url);

/** 宿主根目录：本脚本在 `apps/playground/scripts/` 下 */
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 章节 id 下发给开发服务器与浏览器的环境变量名 */
const ENTRY_ENV = "VITE_LFEN_ENTRY";

/**
 * 取桌面命令的可执行文件路径。
 *
 * 走包的 `package.json` 再拼 `bin/`：包的主入口是编译产物目录，
 * 从那里拼不出可执行文件的位置。
 */
function resolveTauriBin() {
  const manifest = requireFromScript.resolve("@tauri-apps/cli/package.json");
  return join(dirname(manifest), "tauri.js");
}

/**
 * 取出真正要解析的参数：桌面命令的子命令由本脚本自己补，
 * 调用方习惯带上 `dev` 时把它摘掉，免得被当成章节 id。
 */
function stripSubcommand(argv) {
  return argv[0] === "dev" ? argv.slice(1) : argv;
}

/**
 * 桌面命令自己的其它子命令：这些交给桌面命令自己处理，本脚本不碰它们的参数。
 *
 * `dev` 另有一份专属处理（见 `stripSubcommand`），因为只有它要带章节。
 */
const TAURI_OTHER_SUBCOMMANDS = [
  "build",
  "bundle",
  "info",
  "add",
  "remove",
  "plugin",
  "icon",
  "signer",
  "init",
  "migrate",
  "completions",
  "permission",
  "capability",
  "inspect",
];

/** 判断参数是不是桌面命令自己的其它子命令 */
function isOtherSubcommand(arg) {
  return arg !== undefined && TAURI_OTHER_SUBCOMMANDS.includes(arg);
}

/** 把子进程输出按行加前缀转发，便于分辨是谁在说话 */
function tag(name) {
  return (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim() !== "") process.stdout.write(`[${name}] ${line}\n`);
    }
  };
}

/** 主流程：解析参数 → 定章节 → 起桌面命令 */
async function main() {
  const argv = process.argv.slice(2);
  const { runDevCommand } = await import("@lingfan-engine/stories-build/dev");
  if (isOtherSubcommand(argv[0])) {
    await runTauri(argv);
    return;
  }
  const result = runDevCommand(stripSubcommand(argv), APP_ROOT, {
    foreign: "passthrough",
  });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.done) {
    process.exit(result.exitCode);
  }
  const env = { ...process.env };
  if (result.entryId !== undefined) env[ENTRY_ENV] = result.entryId;
  await runTauri(["dev", ...result.passthrough], env);
}

/** 起桌面命令并把它的输出转发出来 */
function runTauri(args, env = { ...process.env }) {
  const child = spawn(process.execPath, [resolveTauriBin(), ...args], {
    cwd: APP_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", tag("桌面宿主"));
  child.stderr.on("data", tag("桌面宿主"));
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

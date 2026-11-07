/**
 * 生成之后的两个副作用：装依赖、打印下一步。
 *
 * 为什么单独成文件：这两件事都要按调用方的包管理器变写法，而组合编排
 * （`cli.ts`）不该关心命令怎么拼。生成器是给**别人**用的工具，本仓开发固定
 * pnpm 是仓库约定，不是产物约定——`npm create` 起的进程就该看到 npm 的命令。
 */
import { spawn } from "node:child_process";
import type { CreateTexts, PackageManager } from "../shared/index.ts";

/**
 * 在生成的工程里装依赖。
 *
 * 命令与可执行名都取自 `manager`：装了 npm 的人未必装了 pnpm，反过来也一样，
 * 猜错就是一句「找不到命令」。`shell` 在 Windows 上是必需的——npm 与 pnpm 的
 * 可执行是 `.cmd`，不带 shell 直接 spawn 会 ENOENT。
 */
export async function installProject(
  dir: string,
  manager: PackageManager,
): Promise<boolean> {
  return await new Promise<boolean>((done) => {
    const child = spawn(manager.id, [manager.install], {
      cwd: dir,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

/**
 * 把文案里的 `<install>` / `<dev>` 换成该包管理器的实际写法。
 *
 * 生成后的提示若写死 `pnpm install`，用 npm 的人第一步就会撞上「没有这个命令」
 * ——这类提示写错比不写更糟，因为它看起来像官方指引。
 */
export function fillManagerCommands(
  text: string,
  manager: PackageManager,
): string {
  return text
    .split("<install>")
    .join(`${manager.id} ${manager.install}`)
    .split("<dev>")
    .join(`${manager.id} ${manager.script}`);
}

/** 生成后的三步提示：`cd` 到工程目录、装依赖、跑起来 */
export function renderNextSteps(
  projectDir: string,
  manager: PackageManager,
  texts: CreateTexts,
): string {
  return fillManagerCommands(
    texts.nextSteps.split("<name>").join(projectDir),
    manager,
  );
}

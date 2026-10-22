/**
 * 发布前把仓库里的模板内容复制进本包。
 *
 * 为什么需要这一步：模板的权威位置是仓库根的 `template/v1`——它随引擎一起演进，
 * 也被仓库自己的防腐判据盯着。但 npm 包只能带走本包目录里的东西，装到别人机器上时
 * 仓库根并不存在。所以发布（`prepack`）时把模板快照复制到 `packages/create/template`，
 * 运行期由 `resolveTemplateRoot` 优先在这里找。
 *
 * 复制而非移动：`template/v1` 始终是唯一事实来源，这份是构建产物，不进版本库。
 * 每次复制前先清空目标目录，避免上一版残留的文件混进新包里。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "..", "..", "template", "v1");
const target = join(packageRoot, "template");

/** 不进模板包的内容：依赖、构建产物、运行时存档与本机私有的字体 */
const SKIP = new Set([
  "node_modules",
  "dist",
  ".git",
  "Saves",
  "private_fonts",
]);

if (!existsSync(join(source, "template-meta.json"))) {
  console.error(`找不到模板源目录：${source}`);
  process.exitCode = 1;
} else {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (item) => !SKIP.has(item.split(/[\\/]/).pop() ?? ""),
  });
  console.log(`模板已复制：${source} → ${target}`);
}

/**
 * 发布前把仓库里的模板内容同步进本包。
 *
 * 为什么需要这一步：模板的权威位置是仓库根的 `template/v1`——它随引擎一起演进，
 * 也被仓库自己的防腐判据盯着。但 npm 包只能带走本包目录里的东西，装到别人机器上时
 * 仓库根并不存在。所以发布（`prepack`）时把模板快照同步到 `packages/create/template`，
 * 运行期由 `resolveTemplateRoot` 优先在这里找。
 *
 * 复制而非移动：`template/v1` 始终是唯一事实来源，这份是构建产物，不进版本库。
 *
 * 为什么按清单同步而不是「整目录删掉重来」：Windows 上目录只要被任何进程持有句柄就
 * 删不掉（编辑器索引、杀毒、文件监视都会），而 `rmSync` 一失败整条发布链就断。删文件
 * 不受这个限制，所以改成——按上一次写下的清单逐个删掉「这次不再产出」的文件，再把
 * 这次产出的文件覆盖上去。目标目录里不会留下陈旧文件，删除目录这件事也就不需要了。
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "..", "..", "template", "v1");
const target = join(packageRoot, "template");

/** 上一次同步写下的文件清单，放在包根而不在 template/ 里，免得被打进 tarball */
const manifestPath = join(packageRoot, ".template-manifest.json");

/** 不进模板包的内容：依赖、构建产物、运行时存档与本机私有的字体 */
const SKIP = new Set([
  "node_modules",
  "dist",
  ".git",
  "Saves",
  "private_fonts",
]);

/** 递归列出源目录里应当进包的文件，路径用 `/` 分隔 */
function listSourceFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile())
        found.push(relative(root, full).split(sep).join("/"));
    }
  };
  walk(root);
  return found.sort();
}

/** 读上一次的清单；没有或读不懂就当空清单（首次同步、清单被删） */
function readManifest() {
  if (!existsSync(manifestPath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

if (!existsSync(join(source, "template-meta.json"))) {
  console.error(`找不到模板源目录：${source}`);
  process.exitCode = 1;
} else {
  const desired = listSourceFiles(source);
  const wanted = new Set(desired);

  // 先删掉这次不再产出的文件：源里删掉的东西不该继续躺在包里
  for (const stale of readManifest()) {
    if (wanted.has(stale)) continue;
    rmSync(join(target, stale), { force: true });
  }

  for (const file of desired) {
    const destination = join(target, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(source, file), destination);
  }

  writeFileSync(manifestPath, `${JSON.stringify(desired, null, 2)}\n`, "utf8");
  console.log(`模板已同步：${source} → ${target}（${desired.length} 个文件）`);
}

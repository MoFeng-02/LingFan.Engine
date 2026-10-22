/**
 * 点文件名还原。
 *
 * npm 把包安装到 `node_modules` 时，会把包内的 `.gitignore` 改名成 `.npmignore`
 * （免得某个依赖的忽略规则反过来影响使用者的仓库），但 tarball 里仍然是原名——
 * 同一个文件在「打包后」与「安装后」两个时刻叫法不同。
 *
 * 生成器读的是安装后的目录，所以模板里把这类文件存成不带点开头的普通名字，
 * 由本表在产物里改回去。不还原的后果是具体的：新工程拿不到 `.gitignore`
 * （`node_modules/`、`dist/`、`Resources/Saves/` 会被误提交进版本库），
 * 却多出一个在工程里没有任何作用的 `.npmignore`。
 *
 * 只处理工程根的那一层：嵌套目录里的同名文件由使用者自己管，模板不带。
 */

/** 安装期被 npm 改名过的文件名 → 产物里应有的名字 */
const RESTORED = new Map([["gitignore", ".gitignore"]]);

/**
 * 把模板里为了躲开改名而写的普通文件名还原成点文件名。
 *
 * 只认工程根：`path` 里出现分隔符时原样返回，避免动到使用者目录里的同名文件。
 */
export function restoreDotfile(path: string): string {
  if (path.includes("/")) return path;
  return RESTORED.get(path) ?? path;
}

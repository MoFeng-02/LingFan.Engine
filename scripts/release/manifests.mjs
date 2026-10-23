/**
 * 八份清单的读写：仓库根 + 七个对外包。
 *
 * 为什么集中在一处：版本号散落在八份 `package.json` 里，而它们必须始终同号。
 * 写的时候只改 `version` 那一行、保留原文件的缩进与键序——整份 `JSON.stringify`
 * 回写会把别人手工排版的字段顺序与空行冲掉，让 diff 变成「整个文件都变了」。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  VERSIONED_PACKAGES,
  packageDirOf,
  repoRootPath,
} from "../version-check.mjs";

/**
 * 读出八份清单。
 *
 * 顺序固定：仓库根在前，其余跟随 `VERSIONED_PACKAGES`。发版日志按这个顺序打印，
 * 人核对时不必再排序。
 */
export function readAll() {
  const root = {
    label: "仓库根",
    path: join(repoRootPath, "package.json"),
  };
  const entries = [root];
  for (const name of VERSIONED_PACKAGES) {
    entries.push({
      label: name,
      path: join(packageDirOf(name), "package.json"),
    });
  }
  return entries.map((entry) => ({
    ...entry,
    manifest: JSON.parse(readFileSync(entry.path, "utf8")),
  }));
}

/** 当前版本：以仓库根为准，其余七份的差异由版本自检负责报。 */
export function currentVersion() {
  const [root] = readAll();
  return root.manifest.version;
}

/**
 * 只替换 `version` 字段的值，保留文件其余部分逐字不动。
 *
 * 用正则而不是解析后序列化：`package.json` 里常有注释性字段顺序、分组空行，
 * 序列化回写会让它们全部消失，一条「改版本号」的提交看起来像重写了整个文件。
 * 这个正则只认顶层的 `"version"` —— 嵌套对象里的同名字段（若有）前面有缩进，
 * `^ {2}"version"` 的锚定把它们排除在外。
 */
function replaceVersionField(text, version) {
  const pattern = /^(\s*)"version"(\s*:\s*)"[^"]*"/m;
  if (!pattern.test(text)) {
    throw new Error("清单里找不到 version 字段");
  }
  return text.replace(
    pattern,
    (_whole, indent, colon) => `${indent}"version"${colon}"${version}"`,
  );
}

/**
 * 把八份清单的版本全部写成 `version`。
 *
 * `dryRun` 只报告将改哪些文件，不落盘——发版前先看一眼影响面。
 * 返回实际写入的路径列表。
 */
export function writeAll(version, { dryRun = false } = {}) {
  const written = [];
  for (const entry of readAll()) {
    const text = readFileSync(entry.path, "utf8");
    const next = replaceVersionField(text, version);
    if (next === text) continue;
    if (!dryRun) writeFileSync(entry.path, next);
    written.push(entry.path);
  }
  return written;
}

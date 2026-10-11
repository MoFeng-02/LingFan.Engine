import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STORIES_DIR, type SerializedProject } from "@lingfan/engine";
import { renderFunRegister, type CellScan } from "../cell";
import { walkFiles } from "./walk-files";

/** 写盘所需的位置与内容（全部由编排层算好，本模块只做差量判定与落盘） */
export interface EmitOptions {
  readonly root: string;
  readonly resourcesDir: string;
  readonly storiesDir: string;
  readonly generatedRel: string;
  readonly serialized: SerializedProject;
  readonly cellScan: CellScan;
}

/**
 * 差量写盘 + 生成物更新：
 * - `Stories/**` 由源全量管理——内容不同的产物才写（新增/更新分开计），不在产物集内的
 *   既有列文件 = 陈旧，删除；
 * - 生成物（`<sourcesDir>/<generatedDir>/fun_register.g.ts`）同规则：零守卫时若存在则删除，
 *   否则内容不同才写。它的逻辑路径与 `Stories/**` 不同命名空间，报告里以 `Stories.src/`
 *   开头即生成物。
 * 返回值里的路径都是逻辑路径（相对工程根），供 CLI 直接打印。
 */
export function emitArtifacts(options: EmitOptions): {
  added: string[];
  updated: string[];
  removed: string[];
} {
  const { root, resourcesDir, storiesDir, generatedRel, serialized, cellScan } = options;
  const existing = walkFiles(storiesDir);
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  for (const [rel, text] of serialized.files) {
    const target = join(resourcesDir, rel);
    const exists = existsSync(target);
    if (exists && readFileSync(target, "utf8") === text) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    (exists ? updated : added).push(rel);
  }
  for (const rel of existing.keys()) {
    const logical = `${STORIES_DIR}/${rel}`;
    if (serialized.files.has(logical)) continue;
    rmSync(join(storiesDir, rel), { force: true });
    removed.push(logical);
  }

  const genTarget = join(root, generatedRel);
  if (cellScan.guards.length === 0) {
    if (existsSync(genTarget)) {
      rmSync(genTarget, { force: true });
      removed.push(generatedRel);
    }
  } else {
    const content = renderFunRegister(cellScan);
    if (existsSync(genTarget)) {
      if (readFileSync(genTarget, "utf8") !== content) {
        writeFileSync(genTarget, content);
        updated.push(generatedRel);
      }
    } else {
      mkdirSync(dirname(genTarget), { recursive: true });
      writeFileSync(genTarget, content);
      added.push(generatedRel);
    }
  }
  return { added, updated, removed };
}

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { STORIES_DIR, type SerializedProject } from "@lingfan/engine";
import { renderFunRegister, type CellScan } from "../cell/index.ts";
import { walkFiles } from "../shared/index.ts";

/** 写盘所需的位置与内容（全部由编排层算好，本模块只做差量判定与落盘） */
export interface EmitOptions {
  readonly root: string;
  readonly resourcesDir: string;
  readonly storiesDir: string;
  readonly generatedRel: string;
  readonly serialized: SerializedProject;
  readonly cellScan: CellScan;
  /** 类型面生成物：逻辑相对路径 + 已渲染好的全文（内容由编排层算，本模块只差量落盘） */
  readonly typegen: { readonly rel: string; readonly content: string };
  /** state 类型面生成物（state.gen.d.ts）：与 typegen 同一差量规则的恒产出生成物 */
  readonly stateGen: { readonly rel: string; readonly content: string };
  /** script 命名空间 ambient 声明生成物（script.gen.d.ts）：同规则的恒产出生成物 */
  readonly scriptGen: { readonly rel: string; readonly content: string };
  /** font 字面量类型面生成物（font.gen.d.ts）：同规则的恒产出生成物（空注册表也恒产出） */
  readonly fontGen: { readonly rel: string; readonly content: string };
}

/**
 * 差量写盘 + 生成物更新：
 * - `Stories/**` 由源全量管理——内容不同的产物才写（新增/更新分开计），不在产物集内的
 *   既有列文件 = 陈旧，删除；
 * - 生成物（`<sourcesDir>/<generatedDir>/fun_register.g.ts`、`stories.gen.d.ts`、
 *   `state.gen.d.ts`、`script.gen.d.ts`、`font.gen.d.ts`）同规则：零守卫时若存在则删除，否则内容不同才写。它们的逻辑路径与
 *   `Stories/**` 不同命名空间，报告里以 `Stories.src/` 开头即生成物。
 * 返回值里的路径都是逻辑路径（相对工程根），供 CLI 直接打印。
 */
export function emitArtifacts(options: EmitOptions): {
  added: string[];
  updated: string[];
  removed: string[];
} {
  const {
    root,
    resourcesDir,
    storiesDir,
    generatedRel,
    serialized,
    cellScan,
    typegen,
    stateGen,
    scriptGen,
    fontGen,
  } = options;
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
  // 类型面生成物（stories.gen.d.ts / state.gen.d.ts / script.gen.d.ts / font.gen.d.ts）：恒产出的差量落盘。语义与守卫注册表
  // 相反——空集合也写文件、结构在（注册表退化为 string / 状态面退化为 Record<string, never> / script 声明恒定 /
  // font 面退化为 Record<never, never>），不拿空集合把作者的正常写法判红（见 typegen/render.ts 与 typegen/state-render.ts）。
  writeConstantArtifact(
    join(root, typegen.rel),
    typegen.rel,
    typegen.content,
    added,
    updated,
  );
  writeConstantArtifact(
    join(root, stateGen.rel),
    stateGen.rel,
    stateGen.content,
    added,
    updated,
  );
  writeConstantArtifact(
    join(root, scriptGen.rel),
    scriptGen.rel,
    scriptGen.content,
    added,
    updated,
  );
  writeConstantArtifact(
    join(root, fontGen.rel),
    fontGen.rel,
    fontGen.content,
    added,
    updated,
  );
  return { added, updated, removed };
}

/** 恒产出生成物的差量落盘：存在即内容比较，不同才写（新增/更新分开计）。 */
function writeConstantArtifact(
  target: string,
  rel: string,
  content: string,
  added: string[],
  updated: string[],
): void {
  if (existsSync(target)) {
    if (readFileSync(target, "utf8") !== content) {
      writeFileSync(target, content);
      updated.push(rel);
    }
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  added.push(rel);
}

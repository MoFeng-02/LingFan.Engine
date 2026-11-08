import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  compareOrdinal,
  STORIES_DIR,
  type SerializedProject,
} from "@lingfan-engine/core";
import { renderFunRegister, type CellScan } from "../cell/index.ts";

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
  /** UI 注册表生成物（ui_register.g.ts）：同规则的恒产出生成物（没有 UI 也恒产出） */
  readonly uiGen: { readonly rel: string; readonly content: string };
}

/** 工具状态目录名（相对工程根）：工具的私有状态不属于资源契约，与 `Resources/` 分开放 */
const STATE_DIR = ".lingfan";
/** 产物账文件名（住在工具状态目录里） */
const LEDGER_FILE = "stories-build.json";
/** 本模块会主动删除的产物命名空间（`Stories/**`）的前缀 */
const STORIES_PREFIX = `${STORIES_DIR}/`;

/**
 * 差量写盘 + 生成物更新：
 * - `Stories/**` 的产物内容不同才写（新增/更新分开计）。陈旧判定收窄为「出现在上一轮
 *   产物账里、且不在本轮产物集里」——只有本工具自己写过的路径才可删，作者手写的
 *   `.story` / JSON 列文件从不出现在账里，因此构建不会碰它们；
 * - 生成物（`<sourcesDir>/<generatedDir>/fun_register.g.ts`、`stories.gen.d.ts`、
 *   `state.gen.d.ts`、`script.gen.d.ts`、`font.gen.d.ts`、`ui_register.g.ts`）同规则：零守卫时若存在则删除，否则内容不同才写。它们的逻辑路径与
 *   `Stories/**` 不同命名空间，报告里以 `Stories.src/` 开头即生成物。
 * 返回值里的路径都是逻辑路径（相对资源根），供 CLI 直接打印。
 */
export function emitArtifacts(options: EmitOptions): {
  added: string[];
  updated: string[];
  removed: string[];
} {
  const {
    root,
    resourcesDir,
    generatedRel,
    serialized,
    cellScan,
    typegen,
    stateGen,
    scriptGen,
    fontGen,
    uiGen,
  } = options;
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
  // 清理只在「上一轮账里有、本轮产物集里没有」时发生：账是删除的唯一依据。手写文件
  // 从不出现在账里，因此构建不会删掉作者的 `.story` / 手写 JSON 列文件。
  // 账缺失（首次运行 / 刚升级）时一律不删——旧版本没有账，无法区分「上轮我写的」与
  // 「作者手写的」，宁可不删。
  const previousProducts = readLedger(root);
  if (previousProducts !== undefined) {
    for (const logical of previousProducts) {
      if (!logical.startsWith(STORIES_PREFIX)) continue;
      if (serialized.files.has(logical)) continue;
      const target = join(resourcesDir, logical);
      if (!existsSync(target)) continue;
      rmSync(target, { force: true });
      removed.push(logical);
    }
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
  writeConstantArtifact(
    join(root, uiGen.rel),
    uiGen.rel,
    uiGen.content,
    added,
    updated,
  );
  // 账 = 本轮写进资源根的 `Stories/**` 产物集：下一轮据此判定哪些既有文件是「我的」。
  writeLedger(root, serialized.files.keys());
  return { added, updated, removed };
}

/** 账在磁盘上的形态：只有一个字段，数组按码元序，便于人工 diff 与版本控制。 */
interface ProductsLedger {
  readonly products: readonly string[];
}

/** 逻辑路径 → 落盘绝对路径的账文件位置（工具状态目录，不在资源根内）。 */
function ledgerPath(root: string): string {
  return join(root, STATE_DIR, LEDGER_FILE);
}

/**
 * 读上一轮产物账；返回 `undefined` 表示「没有可用的账」。
 *
 * 缺失、不可解析、结构不符都按同一个结果处理：调用方据此跳过全部清理。旧版本没有账，
 * 无法区分「上轮本工具写的」与「作者手写的」，误删的代价远大于留一个陈旧文件。
 */
function readLedger(root: string): readonly string[] | undefined {
  const target = ledgerPath(root);
  if (!existsSync(target)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const products = (parsed as { products?: unknown }).products;
  if (!Array.isArray(products)) return undefined;
  return products.filter((item): item is string => typeof item === "string");
}

/** 把本轮产物集整体写成账：只取 `Stories/**`、按码元序；内容相同则不碰文件（幂等）。 */
function writeLedger(root: string, products: Iterable<string>): void {
  const sorted = [...products].filter((rel) => rel.startsWith(STORIES_PREFIX));
  sorted.sort(compareOrdinal);
  const ledger: ProductsLedger = { products: sorted };
  const text = `${JSON.stringify(ledger, null, 2)}\n`;
  const target = ledgerPath(root);
  if (existsSync(target) && readFileSync(target, "utf8") === text) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
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

/**
 * 叠加层合并规则。
 *
 * 模板分两层：骨架（`__PROJECT__`，框架无关，任何框架都要）与叠加层
 * （`overlays/<id>`，只含该框架/壳特有的文件）。合并只有三条规则，全部在这里：
 *
 * 1. **同路径覆盖**——叠加层里与骨架同名的文件整体替换骨架那份。
 * 2. **`*.patch.json` 深合并**——叠加层里名为 `package.patch.json` 的文件不是产物，
 *    而是增量：解析成对象后深合进同目录的 `package.json`（这个目录下就是工程根）。
 *    用增量而不是整份替换，是为了让骨架的脚本与依赖始终是唯一事实来源，
 *    叠加层只说「我要多一个依赖、多一条脚本」。
 * 3. 其余文件按相对路径复制。
 *
 * 覆盖只能加不能减：叠加层换了整套页面与宿主之后，骨架里那些被替换掉的部件仍然会
 * 落进产物（小程序形态拿不到浏览器宿主，留着就是一堆没人 import 的死文件）。所以
 * 第 4 条规则是**删除**——层根的 `package.patch.json` 用 `create.remove` 点名要去掉
 * 的路径（文件或目录），删除作用于它之前的层，本层自己的文件随后照常写入。
 *
 * 占位符替换不在这里做——它是纯文本层面的最后一刀，见 `generate` 域。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 叠加层的增量文件名；该名本身不进产物 */
export const PATCH_SUFFIX = ".patch.json";

/**
 * 一份待写文件：工程内相对路径（posix 分隔）+ 内容。
 *
 * 内容一律是字节：模板里有字体、图片这类资源，按文本读会在遇到非法 UTF-8 时
 * 被静默替换成替换符，写回去就把资源改坏了。文本文件在需要时再解码。
 */
export interface PendingFile {
  readonly path: string;
  readonly content: Buffer;
}

/**
 * 递归列出一个目录下的全部文件（相对 `base` 的 posix 路径）。
 *
 * 跳过 `node_modules`、`dist`、`.git` 与 Saves：它们是运行/构建副产物，
 * 不该被复制进新工程。判定按目录名精确匹配，不做后缀猜测。
 */
export function listFiles(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        out.push(relative(base, full).split(sep).join("/"));
      }
    }
  };
  walk(base);
  return out.sort();
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "Saves"]);

/**
 * 把一层目录读成待写文件表；`*.patch.json` 被解析成增量单独返回。
 *
 * 增量不混进文件表——它没有对应的产物文件，合并对象语义与「写一份文本」不同，
 * 混在一起会让调用方每次都要多判一次。
 */
export function readLayer(base: string): {
  readonly files: PendingFile[];
  readonly patch: Readonly<Record<string, unknown>> | undefined;
  readonly removes: readonly string[];
} {
  const files: PendingFile[] = [];
  let patch: Record<string, unknown> | undefined;
  for (const path of listFiles(base)) {
    const name = path.split("/").pop() ?? path;
    if (name.endsWith(PATCH_SUFFIX)) {
      // 只认工程根的那份：嵌套目录里的同名文件按普通文件处理，
      // 免得某个框架在子目录放一个只对子目录包生效的清单时被误当工程清单。
      if (!path.includes("/")) {
        patch = JSON.parse(readFileSync(join(base, path), "utf8")) as Record<
          string,
          unknown
        >;
        continue;
      }
    }
    files.push({ path, content: readFileSync(join(base, path)) });
  }
  return { files, patch, removes: removeList(patch) };
}

/**
 * 读本层 `create.remove` 点名的路径，归一成 posix 相对路径。
 *
 * 必须在**每层各读一次**，不能读合并后的增量：增量深合并时数组由后者整体取代，
 * 两个叠加层各删各的，合并后只剩最后一层的名单。删除是逐层施加的动作，不是配置。
 *
 * 归一规则只有两条——去掉开头的 `./` 与结尾的 `/`：前者是手写 JSON 时的常见笔误，
 * 后者让人能写 `src/pages/` 表示「这个目录」，与写 `src/pages` 等价。
 */
function removeList(
  patch: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  if (patch === undefined) return [];
  const section = patch[CREATE_FIELD];
  if (!isPlainObject(section)) return [];
  const raw = section.remove;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const normalized = item.replace(/^\.\//, "").replace(/\/+$/, "");
    if (normalized.length > 0) out.push(normalized);
  }
  return out;
}

/** 生成器专用字段名；与 `generate` 域共用同一个约定 */
const CREATE_FIELD = "create";

/**
 * 这个路径是否被删除名单命中：精确同名，或落在被点名的目录下。
 *
 * 目录按前缀判，而不是先查磁盘上有没有这个目录——删除发生在「文件表」这一层，
 * 表里可能已经因为上一层被删而不再有该目录，此时仍要拦住本层不该写的文件。
 */
function isRemoved(path: string, removes: readonly string[]): boolean {
  return removes.some(
    (entry) => path === entry || path.startsWith(`${entry}/`),
  );
}

/** 合并结果：文件表（后写覆盖先写）+ 合并后的工程清单增量 */
export interface MergedLayer {
  readonly files: readonly PendingFile[];
  readonly patch: Readonly<Record<string, unknown>> | undefined;
}

/**
 * 依次合并多层目录，先出现的层在前（骨架先，叠加层后）。
 *
 * 同路径后者覆盖前者；每层的删除名单先作用于已有文件表，再写入本层文件；
 * 增量逐层深合并。返回的文件表保持「每个路径只出现一次」，值是最后写入的那份——
 * 调用方可以直接顺序写盘，不需要自己判重。
 */
export function mergeLayers(bases: readonly string[]): MergedLayer {
  const byPath = new Map<string, PendingFile>();
  let patch: Record<string, unknown> = {};
  let hasPatch = false;
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const layer = readLayer(base);
    if (layer.removes.length > 0) {
      for (const path of [...byPath.keys()]) {
        if (isRemoved(path, layer.removes)) byPath.delete(path);
      }
    }
    for (const file of layer.files) byPath.set(file.path, file);
    if (layer.patch) {
      patch = deepMerge(patch, layer.patch);
      hasPatch = true;
    }
  }
  return {
    files: [...byPath.values()],
    patch: hasPatch ? patch : undefined,
  };
}

/**
 * 深合并：普通对象逐键递归，数组与标量由后者整体取代。
 *
 * 数组不拼接是刻意的——`files`、`keywords` 这类字段拼接会得到既非骨架也非叠加层的
 * 第三种值；想改就该整份覆盖，语义可预测。
 */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? deepMerge(current, value)
        : value;
  }
  return out;
}

/** 只认「对象字面量语义」的普通对象：数组与 null 都不算 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

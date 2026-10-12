import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadDeclaredExtensions,
  type ExtensionModuleLoader,
} from "@lingfan/engine";
import { StoryBuildError } from "../shared";

/** Node 侧缺省装载器：相对说明符按工程根解析（与 Stories.src/Resources 同级），裸说明符交给 Node */
export function defaultExtensionLoader(root: string): ExtensionModuleLoader {
  return async (specifier: string) =>
    specifier.startsWith("./") || specifier.startsWith("../")
      ? import(relativeSpecifierUrl(root, specifier))
      : import(specifier);
}

/**
 * 相对说明符 → 可导入的 file URL：Node 的 ESM 解析不给 .ts 补扩展名（本仓源码直接跑 TS），
 * 而清单里的相对说明符沿用 bundler 习惯（`./ext/foo`）。这里先按原样试，文件不存在再补 `.ts`，
 * 让两种写法都能落盘——加载失败仍是 fail-closed，只是不再因写法差异误报。
 */
function relativeSpecifierUrl(root: string, specifier: string): string {
  const target = resolve(root, specifier);
  const candidates = [target, `${target}.ts`, `${target}/index.ts`];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  return pathToFileURL(target).href;
}

/** 清单 `extensions` 声明读取与形状校验（缺席/为空 = 空数组零装载；形状非法 fail-closed） */
export function readDeclaredExtensions(manifest: unknown): string[] {
  const declared = (manifest as { extensions?: unknown } | null)?.extensions;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw new StoryBuildError(
      `清单 extensions 必须为数组（扩展模块说明符声明），收到 ${JSON.stringify(declared)}`,
    );
  }
  for (const specifier of declared) {
    if (typeof specifier !== "string" || specifier === "") {
      throw new StoryBuildError(
        `清单 extensions 条目必须为非空模块说明符，收到 ${JSON.stringify(specifier)}`,
      );
    }
  }
  return declared as string[];
}

/** 声明制装载（与运行期同一契约）+ 该轮装载到的全部 op 名（unknown-op 闸门的判定输入）+ 扩展 id */
export async function loadExtensions(
  root: string,
  manifest: unknown,
): Promise<{ declared: string[]; opNames: Set<string>; ids: string[] }> {
  const declared = readDeclaredExtensions(manifest);
  const loaded = await loadDeclaredExtensions(
    declared,
    defaultExtensionLoader(root),
  );
  const opNames = new Set(
    loaded.flatMap((extension) => (extension.ops ?? []).map((def) => def.op)),
  );
  // id 供类型面生成器写 `ext.<id>.${string}` 插值键模式（加载期拿到的就是已解析的 id）
  const ids = loaded.map((extension) => extension.id);
  return { declared, opNames, ids };
}

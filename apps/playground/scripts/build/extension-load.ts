import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadDeclaredExtensions,
  type ExtensionModuleLoader,
} from "@lingfan/engine";
import { StoryBuildError } from "./errors";

/** Node 侧缺省装载器：相对说明符按工程根解析（与 Stories.src/Resources 同级），裸说明符交给 Node */
export function defaultExtensionLoader(root: string): ExtensionModuleLoader {
  return async (specifier: string) =>
    specifier.startsWith("./") || specifier.startsWith("../")
      ? import(pathToFileURL(resolve(root, specifier)).href)
      : import(specifier);
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

/** 声明制装载（与运行期同一契约）+ 该轮装载到的全部 op 名（unknown-op 闸门的判定输入） */
export async function loadExtensions(
  root: string,
  manifest: unknown,
): Promise<{ declared: string[]; opNames: Set<string> }> {
  const declared = readDeclaredExtensions(manifest);
  const loaded = await loadDeclaredExtensions(
    declared,
    defaultExtensionLoader(root),
  );
  const opNames = new Set(
    loaded.flatMap((extension) => (extension.ops ?? []).map((def) => def.op)),
  );
  return { declared, opNames };
}

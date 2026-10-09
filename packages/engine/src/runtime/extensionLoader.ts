/**
 * 声明制扩展装载（清单 `extensions` 声明 → 动态 import → 注册校验）。
 *
 * **声明制，非目录扫描制**：扫描器对未声明的扩展文件零感知（不扫盘、不猜测）——
 * 工程清单 `extensions: string[]` 声明宿主模块说明符，组合根按声明装载，避免任意代码执行面。
 * 模块解析归宿主（WebView / Tauri / vite 打包器的 import 语义各不相同）——本模块只接收
 * **注入式装载器**（`importModule` 回调）并做形状校验（fail-closed，带 specifier 定位）；
 * 声明缺席/为空 = 返回空数组且装载器一次都不触（零副作用）。
 * 全量冲突/重名/内建冲突校验归引擎构造期 `buildOpRegistry`（本处只验「是不是一个声明」）。
 */

import { EXTENSION_ID_PATTERN, type OpExtension } from "../contracts";

/** 宿主注入的模块装载器（如 `(s) => import(s)` / vite `import.meta.glob` 取得的 loader） */
export type ExtensionModuleLoader = (specifier: string) => Promise<unknown>;

/** 统一构造装载失败错误：带上模块说明符，便于定位是清单里哪条声明出的问题 */
function invalid(specifier: string, reason: string): Error {
  return new Error(`扩展装载失败：${specifier} —— ${reason}`);
}

/** 非 null 的对象判据；数组也会通过（此处只用于粗形状守卫，不区分数组与字典） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 校验模块默认导出是一个 OpExtension 声明（粗形状守卫） */
function asExtension(specifier: string, loaded: unknown): OpExtension {
  if (!isRecord(loaded) || !isRecord(loaded.default)) {
    throw invalid(specifier, "模块未提供默认导出（须为 OpExtension 声明）");
  }
  const declaration = loaded.default;
  const id = declaration.id;
  if (typeof id !== "string" || !EXTENSION_ID_PATTERN.test(id)) {
    throw invalid(
      specifier,
      `id 不合法：${String(id)}（须匹配 ${EXTENSION_ID_PATTERN.source}）`,
    );
  }
  const stateVersion = declaration.stateVersion;
  if (
    typeof stateVersion !== "number" ||
    !Number.isInteger(stateVersion) ||
    stateVersion < 1
  ) {
    throw invalid(
      specifier,
      `stateVersion 不合法：${String(stateVersion)}（须为正整数）`,
    );
  }
  if (declaration.ops !== undefined && !Array.isArray(declaration.ops)) {
    throw invalid(specifier, "ops 须为数组");
  }
  for (const op of (declaration.ops ?? []) as unknown[]) {
    if (
      !isRecord(op) ||
      typeof op.op !== "string" ||
      op.op === "" ||
      typeof op.exec !== "function"
    ) {
      throw invalid(specifier, "ops 条目须为 { op: 非空名, exec: 函数 }");
    }
  }
  return declaration as unknown as OpExtension;
}

/**
 * 按声明装载扩展（组合根装配期调用一次）：
 * - 缺席/空数组 → `[]`（**零副作用**：装载器一次不触——未声明 = 未加载 = 未注册）
 * - 逐个经宿主装载器加载 → 默认导出形状校验（fail-closed，抛错带 specifier 定位）
 * - 返回后由组合根传入 `new StoryEngine({ extensions })` 与编辑器 `mergeOpSurface`
 */
export async function loadDeclaredExtensions(
  declared: readonly string[] | undefined,
  loadModule: ExtensionModuleLoader,
): Promise<OpExtension[]> {
  if (declared === undefined || declared.length === 0) return [];
  const out: OpExtension[] = [];
  for (const specifier of declared) {
    if (typeof specifier !== "string" || specifier === "") {
      throw new Error(
        `扩展声明不合法：${JSON.stringify(specifier)}（须为非空模块说明符）`,
      );
    }
    let loaded: unknown;
    try {
      loaded = await loadModule(specifier);
    } catch (error: unknown) {
      throw invalid(
        specifier,
        `模块装载失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    out.push(asExtension(specifier, loaded));
  }
  return out;
}

/**
 * 工程清单里 i18n 别名配置的解析（纯函数：已解析的清单对象 → 别名清单）。
 *
 * 本域只做形状校验，不触 IO：读 project.json 与 JSON.parse 属 CLI/宿主的
 * IO 接线层（坏 JSON 的报错文案也在那里）；空清单/空名的判定与文案在
 * scan/ast-scan 的 `functionNamesOf` 唯一事实源，这里不重复判定。
 */

/**
 * 从工程清单读 `i18n.functions` 别名清单（显式配置，不隐式猜测）。
 * 只做形状校验：缺席 ⇒ undefined；非数组/含非字符串 ⇒ 抛含 `i18n.functions` 的
 * Error（fail-closed，配置写错不能静默当没配）。`[]` 与含 `""` 原样返回——
 * 空清单/空名的判定与文案在 ast-scan `functionNamesOf` 唯一事实源。
 */
export function resolveI18nFunctions(
  manifest: unknown,
): readonly string[] | undefined {
  if (manifest === null || typeof manifest !== "object") return undefined;
  const i18n = (manifest as Record<string, unknown>).i18n;
  if (i18n === undefined || i18n === null) return undefined;
  if (typeof i18n !== "object" || Array.isArray(i18n)) {
    throw new Error(
      "project.json 的 i18n 段必须是对象（i18n.functions 别名清单住在这里）",
    );
  }
  const functions = (i18n as Record<string, unknown>).functions;
  if (functions === undefined) return undefined;
  if (
    !Array.isArray(functions) ||
    functions.some((name) => typeof name !== "string")
  ) {
    throw new Error('project.json 的 i18n.functions 必须是字符串数组（如 ["t", "tr"]）');
  }
  return functions as readonly string[];
}
/**
 * worker 源码模板：`String.raw` + 文件内无 `$` 插值起点，搬迁时内容必须逐字保持。
 */
export const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");

/** 返回 null = JSON 可序列化；否则返回不可序列化原因。 */
function classify(value, seen) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "非有限数值（NaN/Infinity）";
  if (typeof value === "function") return "函数（function）";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (typeof value !== "object") return "不可序列化类型（" + String(typeof value) + "）";
  if (seen.has(value)) return "循环引用";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) return "数组空洞（undefined 元素）";
        const element = classify(value[i], seen);
        if (element !== null) return element;
      }
      return null;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const name = (proto.constructor && proto.constructor.name) || "unknown";
      return "非普通对象（" + name + " 实例：Date/Map/Set/class 等不保证可序列化）";
    }
    for (const key of Object.keys(value)) {
      const member = classify(value[key], seen);
      if (member !== null) return member;
    }
    return null;
  } finally {
    seen.delete(value);
  }
}

(async () => {
  try {
    const requireEsbuild = createRequire(workerData.esbuildPath);
    const esbuild = requireEsbuild(workerData.esbuildPath);
    const result = await esbuild.build({
      entryPoints: [workerData.entry],
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
      logLevel: "silent",
      absWorkingDir: workerData.workDir,
    });
    const code = result.outputFiles[0].text;

    const moduleObj = { exports: {} };
    const runRequire = createRequire(workerData.entry);

    // define / defineVars：config.ts 构建期内建（求值环境注入，无运行时实体）。
    // define 二态：字符串首参 = 点路径单值；普通对象首参 = 子树声明；值过 classify
    // 才入列（非法值进 defineBad，由求值段翻成诊断）。defineVars 返回实参本身，
    // 使 export const vars = defineVars({...}) 的导出值 = 键集对象（vars 键来源）。
    const defineCalls = [];
    const defineBad = [];
    function define(pathOrSpec, value) {
      if (typeof pathOrSpec === "string") {
        const reason = classify(value, new Set());
        if (reason !== null) {
          defineBad.push({ path: pathOrSpec, reason: "值不可序列化（" + reason + "）" });
          return;
        }
        defineCalls.push({ kind: "path", path: pathOrSpec, value: value });
        return;
      }
      if (pathOrSpec !== null && typeof pathOrSpec === "object" && !Array.isArray(pathOrSpec)) {
        const reason = classify(pathOrSpec, new Set());
        if (reason !== null) {
          defineBad.push({ path: "(对象实参)", reason: "对象实参不可序列化（" + reason + "）" });
          return;
        }
        defineCalls.push({ kind: "spec", spec: pathOrSpec });
        return;
      }
      defineBad.push({ path: "(实参)", reason: "首参须为点路径字符串或对象字面量" });
    }
    function defineVars(spec) {
      return spec;
    }

    const factory = new Function(
      "module",
      "exports",
      "require",
      "__filename",
      "__dirname",
      "define",
      "defineVars",
      code,
    );
    factory(moduleObj, moduleObj.exports, runRequire, workerData.entry, path.dirname(workerData.entry), define, defineVars);
    try { delete moduleObj.exports.__esModule; } catch { /* 不可删则忽略 */ }

    const values = {};
    const bad = [];
    for (const key of Object.keys(moduleObj.exports)) {
      const reason = classify(moduleObj.exports[key], new Set());
      if (reason === null) values[key] = moduleObj.exports[key];
      else bad.push({ key, reason });
    }
    parentPort.postMessage({ kind: "exports", values, bad, defineCalls, defineBad });
  } catch (error) {
    if (error !== null && typeof error === "object" && Array.isArray(error.errors)) {
      const diags = error.errors.map((item) => {
        const at = item.location ?? null;
        return {
          file: (at && at.file) || workerData.entry,
          line: (at && at.line) || 1,
          col: ((at && at.column) ?? 0) + 1,
          message: item.text ?? String(item),
        };
      });
      parentPort.postMessage({ kind: "esbuild-error", diags });
      return;
    }
    parentPort.postMessage({
      kind: "runtime-error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
})();
`;

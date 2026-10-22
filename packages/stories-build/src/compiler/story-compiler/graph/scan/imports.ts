import * as ts from "typescript";
import { WORD_NAMES, GEN_PREFIX, toPosix } from "../core.ts";
import type { ModuleRecord, DiagBag } from "../core.ts";

function resolveModuleFile(rel: string, spec: string): string | null {
  const dirParts = toPosix(rel).split("/").slice(0, -1);
  const specParts = toPosix(spec).split("/");
  const out: string[] = [];
  for (const part of [...dirParts, ...specParts]) {
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else if (part !== "." && part !== "") {
      out.push(part);
    }
  }
  const base = out.join("/");
  if (base === "" || !base.endsWith(".ts")) return null;
  return base;
}

function resolveModuleImportPath(rel: string, spec: string): string | null {
  const candidates: string[] = [];
  const normalized = toPosix(spec);
  if (normalized.endsWith(".ts")) {
    candidates.push(normalized);
  } else {
    candidates.push(`${normalized}.ts`, `${normalized}/index.ts`);
  }
  for (const c of candidates) {
    const resolved = resolveModuleFile(rel, c);
    if (resolved !== null) return resolved;
  }
  return null;
}

export function resolveImports(
  record: ModuleRecord,
  records: Map<string, ModuleRecord>,
  diags: DiagBag,
  editorPass: boolean,
): void {
  const { sf, rel } = record;
  for (const imp of record.imports) {
    const spec = ts.isStringLiteral(imp.moduleSpecifier)
      ? imp.moduleSpecifier.text
      : "";
    if (editorPass !== (spec === "@lingfan-engine/editor")) continue;
    const clause = imp.importClause;
    if (clause === undefined) {
      diags.add(rel, sf, imp, "副作用导入不支持：请显式导入所需符号");
      continue;
    }
    if (spec === "@lingfan-engine/editor") {
      if (clause.name !== undefined) {
        diags.add(
          rel,
          sf,
          clause.name,
          '词汇层请以具名导入（import { say, … } from "@lingfan-engine/editor"）或 script 命名空间使用',
        );
      }
      if (
        clause.namedBindings !== undefined &&
        ts.isNamespaceImport(clause.namedBindings)
      ) {
        record.bindings.set(clause.namedBindings.name.text, {
          kind: "namespace",
        });
      }
      if (
        clause.namedBindings !== undefined &&
        ts.isNamedImports(clause.namedBindings)
      ) {
        for (const el of clause.namedBindings.elements) {
          if (el.isTypeOnly) continue;
          // `import { script as ct }` 里 ct 是本地名、script 才是被导入的名字。判定与查表
          // 一律用被导入名（propertyName 优先），绑定表的键才用本地名——两者混用会让
          // `import { say as 说 }` 去查一个叫「说」的词（必然不存在）。
          const imported = el.propertyName?.text ?? el.name.text;
          if (imported === "script") {
            record.bindings.set(el.name.text, { kind: "namespace" });
            continue;
          }
          if (!WORD_NAMES.has(imported)) {
            diags.add(rel, sf, el, `词汇层不存在词 \`${imported}\``);
            continue;
          }
          record.bindings.set(el.name.text, { kind: "word", name: imported });
        }
      }
      continue;
    }
    if (clause.isTypeOnly) continue;
    if (spec === "@lingfan-engine/core") {
      diags.add(rel, sf, imp, "引擎包不参与创作导入：请使用词汇层词函数");
      continue;
    }
    if (!spec.startsWith(".")) {
      if (record.evaluated === undefined) {
        diags.add(
          rel,
          sf,
          imp,
          `导入仅限相对路径与词汇层既有出口，不支持外部包 \`${spec}\``,
        );
        continue;
      }
      // 经编译期求值的文件允许 node_modules 值导入——值经求值结果内联，
      // 引用域仅限模块层 const 初始化链（buildGraph 末尾 assertNpmNamesConstOnly 兜底）。
      continue;
    }
    const targetRel = resolveModuleImportPath(rel, spec);
    if (targetRel === null) {
      diags.add(rel, sf, imp, `模块说明符 \`${spec}\` 必须解析到相对 .ts 文件`);
      continue;
    }
    if (targetRel.startsWith(GEN_PREFIX)) {
      diags.add(rel, sf, imp, "gen/ 生成物不参与创作导入");
      continue;
    }
    const target = records.get(targetRel);
    if (target === undefined) {
      diags.add(rel, sf, imp, `找不到模块：${spec}`);
      continue;
    }
    if (clause.name !== undefined) {
      if (target.story === null) {
        diags.add(
          rel,
          sf,
          clause.name,
          `纯模块 ${targetRel} 没有 default 导出——跨故事引用请导入故事文件`,
        );
      } else {
        record.bindings.set(clause.name.text, {
          kind: "story",
          file: targetRel,
          name: target.story.name,
        });
      }
    }
    if (
      clause.namedBindings !== undefined &&
      ts.isNamespaceImport(clause.namedBindings)
    ) {
      diags.add(
        rel,
        sf,
        clause.namedBindings,
        "命名空间导入仅支持词汇层 script",
      );
    }
    if (
      clause.namedBindings !== undefined &&
      ts.isNamedImports(clause.namedBindings)
    ) {
      for (const el of clause.namedBindings.elements) {
        if (el.isTypeOnly) continue;
        const wanted = el.propertyName?.text ?? el.name.text;
        const binding = target.exports.get(wanted);
        if (binding === undefined) {
          diags.add(rel, sf, el, `模块 ${targetRel} 未导出 \`${wanted}\``);
          continue;
        }
        record.bindings.set(el.name.text, binding);
      }
    }
  }
}

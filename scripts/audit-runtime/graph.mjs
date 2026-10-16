import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { classifySpecifier, lineAt, scanProcessUsage } from "./specifiers.mjs";

/**
 * 去掉注释后的源码。
 *
 * 必须去注释：注释里的导入语句是写法示例，不是真实依赖，按命中处理会逼着维护者改注释
 * 来规避判据。字符串保留——说明符本来就在字符串里，丢掉字符串等于漏掉真实导入。
 */
export function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** 抽取一份源码里的全部导入说明符，形如 `{ spec, line }`（按出现去重） */
export function extractSpecifiers(text) {
  const body = stripComments(text);
  const found = [];
  const seen = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const spec = match[1];
      const key = `${spec}@${match.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ spec, line: lineAt(body, match.index) });
    }
  }
  return found;
}

function packageDirOf(spec, repoRoot) {
  const segments = spec.split("/");
  const packageName = spec.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
  const subpath = spec.slice(packageName.length);
  return {
    packageName,
    subpath,
    dir: join(repoRoot, "packages", packageName.replace("@lingfan/", "")),
  };
}

function exportsTarget(exportsField, subpath) {
  const key = subpath === "" ? "." : `.${subpath}`;
  const value = exportsField?.[key];
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return value.import ?? value.default ?? value.types ?? null;
  }
  return null;
}

function fileCandidates(base) {
  return [
    base,
    `${base}.ts`,
    `${base}.mts`,
    `${base}.js`,
    join(base, "index.ts"),
    base.replace(/\.js$/, ".ts"),
  ];
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * 解析一条导入说明符到磁盘文件。
 *
 * 返回 `{ kind, file }` 或 `{ kind: "unresolved", reason }`——工作区包按它自己的
 * `package.json#exports` 找出口，不假设 `src/index.ts`：出口换了，门禁要跟着换网。
 */
export function resolveImport(spec, importerFile, repoRoot) {
  const verdict = classifySpecifier(spec);
  if (verdict.kind !== "relative" && verdict.kind !== "workspace")
    return verdict;

  if (verdict.kind === "relative") {
    const file = firstExisting(
      fileCandidates(resolve(dirname(importerFile), spec)),
    );
    return file === null
      ? { kind: "unresolved", reason: `相对导入解析失败：${spec}` }
      : { kind: "relative", file };
  }

  const { subpath, dir } = packageDirOf(spec, repoRoot);
  const manifestPath = join(dir, "package.json");
  if (!existsSync(manifestPath)) {
    return { kind: "unresolved", reason: `工作区包不存在：${spec}` };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const target = exportsTarget(manifest.exports, subpath);
  const file =
    target === null
      ? firstExisting([join(dir, "src/index.ts")])
      : firstExisting(fileCandidates(resolve(dir, target)));
  return file === null
    ? { kind: "unresolved", reason: `工作区包出口解析失败：${spec}` }
    : { kind: "workspace", file };
}

/**
 * 从若干入口出发遍历可达图。
 *
 * 返回 `{ files, violations, unresolved, externals }`：
 * - `files`：可达源文件绝对路径；
 * - `violations`：`{ file, line, reason }`；
 * - `unresolved`：解析失败的导入（按失败处理，不静默放行）；
 * - `externals`：不遍历的第三方包名（报告用，便于人工判断某个外依赖是否 Node 专属）。
 */
export function walkGraph(entrySpecs, repoRoot) {
  const files = new Set();
  const violations = [];
  const unresolved = [];
  const externals = new Set();
  const queue = [];

  for (const entrySpec of entrySpecs) {
    const resolved = resolveImport(
      entrySpec,
      join(repoRoot, "package.json"),
      repoRoot,
    );
    if (resolved.file === undefined) {
      unresolved.push({
        file: entrySpec,
        line: 0,
        reason: resolved.reason ?? `入口解析失败：${entrySpec}`,
      });
      continue;
    }
    queue.push(resolved.file);
  }

  while (queue.length > 0) {
    const file = queue.pop();
    if (files.has(file)) continue;
    files.add(file);
    const text = readFileSync(file, "utf8");
    for (const { spec, line } of extractSpecifiers(text)) {
      const resolved = resolveImport(spec, file, repoRoot);
      if (resolved.kind === "violation") {
        violations.push({ file, line, reason: resolved.reason });
      } else if (resolved.kind === "unresolved") {
        unresolved.push({ file, line, reason: resolved.reason });
      } else if (resolved.kind === "external") {
        externals.add(resolved.name);
      } else if (resolved.file !== undefined) {
        queue.push(resolved.file);
      }
    }
    for (const hit of scanProcessUsage(stripComments(text))) {
      violations.push({
        file,
        line: hit.line,
        reason: `Node 运行期全局 process.${hit.text.replace(/^process\s*\.\s*/, "")}`,
      });
    }
  }

  return { files, violations, unresolved, externals };
}

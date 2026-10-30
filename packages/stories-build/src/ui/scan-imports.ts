/**
 * UI 文件的 import 面：先提取说明符，再对照允许清单判定。
 *
 * 为什么需要这一层：UI 文件不进 stories-build 的编译链（不读、不编译、不拷贝），
 * 所以里面写了什么 import 构建期本来一无所知。而宿主侧的打包器**不一定拦得住**——
 * `@/host/boot` 在宿主工程里是合法路径，能解析、能打包，但那是把宿主拖进 UI 的
 * 反向依赖：换形态、换壳必炸，且依赖图上看不见。这里补的就是这道静态校验。
 *
 * 两侧禁的是同一件事的两个方向，别混：**UI 侧**不许 import `@/gen/**`（依赖构建顺序），
 * 由本文件判定；**故事源侧**不许 import `gen/**`（生成物不参与创作导入），由编译器
 * 图谱层判定。执行点不同，报错文案也不同。
 *
 * 提取不用正则：`import` / `export` / `import type` / `import()` / `require` /
 * 注释里的假 import 六种形态，正则必漏一种。走 TypeScript 自己的 AST，
 * 注释与字符串天然被排除，动态导入与 `require` 递归补齐。
 */
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import * as ts from "typescript";
import { DEFAULT_GENERATED_DIR } from "../shared/index.ts";
import { UI_DIR_NAME, type UiFileEntry } from "./ui-registry.ts";

/** 一条 import 引用：说明符 + 1-based 行号（报错用）+ 是否纯类型 */
export interface UiImportRef {
  readonly specifier: string;
  readonly line: number;
  readonly typeOnly: boolean;
}

/** 一条越界 import 的判定结果；`file` 是相对 `src/` 的 posix 路径 */
export interface UiImportViolation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly reason: string;
}

/** 允许的框架包（UI 存在的理由，精确匹配，不接受子路径） */
const FRAMEWORK_PACKAGES: ReadonlySet<string> = new Set([
  "vue",
  "react",
  "react-dom",
  "react/jsx-runtime",
]);

/**
 * 从一份 UI 文件源码提取全部 import 引用。
 *
 * `ext` 决定解析方式：`.vue` 只扫 `<script>` / `<script setup>` 块（`<style>` 里的
 * `@import` 不管，它不是模块依赖）；`.html` 只扫 `<script type="module">` 块
 * （老式 `<script>` 不能 import）；`.tsx` / `.ts` 整份按 TS 处理。
 *
 * 块内 import 的行号取原文件的行号：抽块时把块外内容替换成等量空格、保留换行，
 * 于是 AST 报出的位置与作者在编辑器里看到的一致。
 */
export function scanUiImports(source: string, ext: string): UiImportRef[] {
  const extension = ext.toLowerCase();
  if (extension === ".vue") {
    return refsIn(scriptSkeleton(source, false), "ui.vue");
  }
  if (extension === ".html") {
    return refsIn(scriptSkeleton(source, true), "ui.html");
  }
  return refsIn(source, extension === ".tsx" ? "ui.tsx" : "ui.ts");
}

/**
 * 对照允许清单判定一批引用，返回越界项。
 *
 * 判定顺序**先判越界再判允许**：`@/host/x` 与 `@/ui/../host/x` 都必须落到「越出
 * src/ui」那条，而不是被「别名 UI」规则顺手放过。
 */
export function checkUiImports(
  file: string,
  refs: readonly UiImportRef[],
): UiImportViolation[] {
  const violations: UiImportViolation[] = [];
  for (const ref of refs) {
    const reason = reasonOf(file, ref);
    if (reason === undefined) continue;
    violations.push({
      file,
      line: ref.line,
      specifier: ref.specifier,
      reason,
    });
  }
  return violations;
}

/**
 * 扫描整棵 UI 树并判定：`uiRoot` 是磁盘上的 `src/ui/`，`entries` 来自注册表扫描。
 *
 * 只认注册表登记过的 `<名>/<名>.<扩展名>`，与导入期、列级 `uis` 闸门同一套落位规则。
 */
export function scanUiTreeImports(
  uiRoot: string,
  entries: readonly UiFileEntry[],
): UiImportViolation[] {
  const violations: UiImportViolation[] = [];
  for (const entry of entries) {
    const source = readFileSync(join(uiRoot, entry.name, entry.file), "utf8");
    const ext = entry.file.slice(entry.file.lastIndexOf("."));
    const file = `${UI_DIR_NAME}/${entry.name}/${entry.file}`;
    for (const violation of checkUiImports(file, scanUiImports(source, ext))) {
      violations.push(violation);
    }
  }
  return violations;
}

/** 一条引用的拒绝理由；`undefined` = 通过 */
function reasonOf(file: string, ref: UiImportRef): string | undefined {
  const specifier = ref.specifier;
  const root = specifier.startsWith("@/") ? specifier.slice(2) : undefined;

  // 相对路径与 `@/ui/**` 等价：都折成相对 `src/` 的路径再判沙箱。
  if (
    isRelative(specifier) ||
    root === "ui" ||
    root?.startsWith("ui/") === true
  ) {
    const resolved = resolveInSrc(file, specifier);
    if (resolved === "ui" || resolved.startsWith("ui/")) return undefined;
    return `UI 不得引用 src/ui 之外的文件（解析为 src/${resolved}）`;
  }

  if (root !== undefined) {
    if (isUnder(root, DEFAULT_GENERATED_DIR)) {
      return `UI 不得依赖构建产物：生成物随构建顺序变，UI 会被迫跟着重建（${specifier}）`;
    }
    if (isUnder(root, "host")) {
      return `UI 不得反向依赖宿主：宿主是 UI 的调用方，反向依赖成环（${specifier}）`;
    }
    if (isUnder(root, "main") || isUnder(root, "boot")) {
      return `UI 不得引用组合根：入口负责装配 UI，UI 不该反过来找入口（${specifier}）`;
    }
    if (isUnder(root, "Stories.src")) {
      return `UI 不得依赖故事源：创作输入与展示层一旦互相引用就焊死了（${specifier}）`;
    }
  }

  if (FRAMEWORK_PACKAGES.has(specifier)) return undefined;

  if (specifier === "@lingfan-engine/core") {
    return ref.typeOnly
      ? undefined
      : "UI 只能从引擎包取类型（import type），不能取运行期值";
  }

  return `UI 不得依赖外部包（拷贝后无法解析）：${specifier}`;
}

/** 说明符是否相对路径（`./` 与 `../` 两种形态） */
function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * 去掉 `@/` 前缀后的路径是否落在 `base` 之下：`base` 本身、`base/…`、或
 * `base.<扩展名>`（作者常写 `@/main.ts` 而不是 `@/main`）。
 *
 * 不用 `startsWith(base)`——那会把 `@/mainmenu` 误判成组合根。
 */
function isUnder(path: string, base: string): boolean {
  return (
    path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}.`)
  );
}

/**
 * 把说明符折成相对 `src/` 的 posix 路径：`@/ui/x` 去掉前缀，相对路径与 `file`
 * 所在目录 join 后 normalize。`..` 段在这里被消掉，越界因此表现为不以 `ui/` 开头。
 */
function resolveInSrc(file: string, specifier: string): string {
  if (specifier.startsWith("@/")) return posix.normalize(specifier.slice(2));
  return posix.normalize(posix.join(posix.dirname(file), specifier));
}

/**
 * 把源码抽成「等行数的骨架」：只有合格的 script 块内容留下，其余全部换成空格。
 *
 * 换成空格而不是删除，是为了让 AST 报出的行列与作者在编辑器里看到的一致；
 * 只留 script 块内容，是为了不让模板里的 `<div>` 之类被 TS 当成类型断言解析，
 * 那会把语法树搅乱（虽然不吞语句，但没人愿意依赖这种巧合）。
 */
function scriptSkeleton(source: string, moduleOnly: boolean): string {
  const lower = source.toLowerCase();
  const chars = source.split("");
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] !== "\n") chars[index] = " ";
  }
  const keep = (from: number, to: number): void => {
    for (let index = from; index < to; index += 1) {
      chars[index] = source.charAt(index);
    }
  };
  let cursor = 0;
  while (cursor < source.length) {
    const open = findTagStart(lower, cursor);
    if (open === -1) break;
    const tagEnd = source.indexOf(">", open);
    if (tagEnd === -1) break;
    const close = lower.indexOf("</script", tagEnd + 1);
    if (close === -1) break;
    const closeEnd = source.indexOf(">", close);
    if (closeEnd === -1) break;
    if (!moduleOnly || hasModuleType(source.slice(open, tagEnd + 1))) {
      keep(tagEnd + 1, close);
    }
    cursor = closeEnd + 1;
  }
  return chars.join("");
}

/** 找 `<script` 起始位置；标签名后面必须紧跟空白、`>` 或 `/`（排除 `<scripted>`） */
function findTagStart(lower: string, from: number): number {
  const needle = "<script";
  let index = lower.indexOf(needle, from);
  while (index !== -1) {
    const next = lower.charAt(index + needle.length);
    if (next === "" || next === ">" || next === "/" || isSpace(next)) {
      return index;
    }
    index = lower.indexOf(needle, index + 1);
  }
  return -1;
}

/** 开标签是否带 `type="module"`（比较前去掉空白，`type = "module"` 同样认） */
function hasModuleType(tag: string): boolean {
  let compact = "";
  for (const char of tag.toLowerCase()) {
    if (!isSpace(char)) compact += char;
  }
  return compact.includes('type="module"') || compact.includes("type='module'");
}

/** 空白字符判定（不用正则：这里只比四个码元） */
function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

/**
 * 解析骨架里的 import 面。
 *
 * 语句层取 `ImportDeclaration` / `ExportDeclaration`；随后递归整棵树补齐动态
 * `import()` 与 `require()`——它们同样是运行期依赖，只是不在语句层。
 */
function refsIn(text: string, fileName: string): UiImportRef[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const refs: UiImportRef[] = [];
  const push = (specifier: string, node: ts.Node, typeOnly: boolean): void => {
    const position = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    refs.push({ specifier, line: position.line + 1, typeOnly });
  };
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      push(
        statement.moduleSpecifier.text,
        statement,
        importTypeOnly(statement),
      );
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      push(specifier.text, statement, statement.isTypeOnly);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const first = node.arguments[0];
      if (
        first !== undefined &&
        ts.isStringLiteralLike(first) &&
        isLoadCall(node)
      ) {
        push(first.text, node, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return refs;
}

/**
 * 导入子句是否纯类型：`import type { A } from "b"` 或
 * `import { type A, type B } from "c"`（内联修饰符，全部元素都是 type 才算）。
 * 副作用导入（只写路径、不带子句的形态）与命名空间导入不算纯类型。
 */
function importTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined || !ts.isNamedImports(bindings)) return false;
  if (bindings.elements.length === 0) return false;
  return bindings.elements.every((element) => element.isTypeOnly);
}

/** 调用是否为模块加载形态：`import(...)` 或 `require(...)` */
function isLoadCall(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  return ts.isIdentifier(node.expression) && node.expression.text === "require";
}

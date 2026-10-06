/**
 * TS 故事源编译 CLI（`pnpm stories:build`，tsx 运行；创作期工具，Node 侧）：
 * `Stories.src/<name>.ts`（恰好一个；default 导出多列 Story，`satisfies Story` 提供编译期
 * 类型检查）→ 既有校验链 `parseStory`（带源名定位）→ `serializeProject`（单列拆分 +
 * 清单保真——与编辑器写回同一条布局规则）→ `assembleProject` 往返自检 → 差量写盘
 * `Resources/Stories/**` + `project.json`（陈旧列文件清理）。
 *
 * 零第二套规则：TS 源合法 ⇔ 其编译产物作为 JSON 合法（与 JSON 同一 parseStory）。
 * 工程清单（entry/defines/shell）不归 TS 源管——必须先有 `Resources/project.json`，
 * 编译只更新其托管键（serializeProject 既有语义）。`Stories/**` 列集由源全量管理：
 * 启用 TS 源的工程，手写列文件会被当作陈旧产物清理（报告逐条列出）。
 * 编辑器/引擎/Rust 对 TS 零感知；TS 源不进打包产物（运行期零攻击面）。
 *
 * 扩展 op 放行（对齐运行期声明制）：清单 `extensions` 声明扩展模块说明符——编译期
 * 用与运行期同一个装载契约（`loadDeclaredExtensions`）装载，收集其提供的 op 名；
 * 故事里既非内建、也未被声明扩展提供的 op 名 = 运行期必 unknown-op ⇒ 构建期即拦截
 * （fail-early，带列与命令指针定位，一次报全部）。声明缺席/为空 = 零装载零副作用。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assembleProject,
  BUILTIN_OP_NAMES,
  loadDeclaredExtensions,
  MANIFEST_FILE,
  parseStory,
  serializeProject,
  STORIES_DIR,
  type ExtensionModuleLoader,
} from "@lingfan/engine";
import {
  script,
  walkStoryCommands,
  type ExpressionWarning,
} from "@lingfan/editor";
import { renderFunRegister, scanCells } from "./cell-extract";

export class StoryBuildError extends Error {}

export interface BuildReport {
  source: string;
  storyId: string;
  columns: number;
  written: string[];
  removed: string[];
  /** 本轮按清单声明装载的扩展说明符（声明缺席/为空 = 空数组，装载器一次不触） */
  extensions: string[];
  /** cell(...) 声明并生成进注册物的守卫名（书写序；缺席 = 空数组） */
  functions: string[];
  /** 词汇层轻类型校验警告（expr/cond 组装时按引擎类型规则产出；不拦构建——引擎/编辑期仍是权威） */
  warnings: ExpressionWarning[];
}

/** 收集目录下全部文件（posix 相对路径 → 文本）；目录不存在 = 空集 */
function walkFiles(dir: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const key = rel === "" ? name : `${rel}/${name}`;
    if (statSync(path).isDirectory()) {
      for (const [child, text] of walkFiles(path, key)) out.set(child, text);
    } else {
      out.set(key, readFileSync(path, "utf8"));
    }
  }
  return out;
}

/** Node 侧缺省装载器：相对说明符按工程根解析（与 Stories.src/Resources 同级），裸说明符交给 Node */
function defaultExtensionLoader(root: string): ExtensionModuleLoader {
  return async (specifier: string) =>
    specifier.startsWith("./") || specifier.startsWith("../")
      ? import(pathToFileURL(resolve(root, specifier)).href)
      : import(specifier);
}

/** 清单 `extensions` 声明读取与形状校验（缺席/为空 = 空数组零装载；形状非法 fail-closed） */
function readDeclaredExtensions(manifest: unknown): string[] {
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

/**
 * 编译 `root/Stories.src/` 下的 TS 源 → `root/Resources/`（纯编排，fs 全在参数 root 之下；
 * 测试用临时工程根直测，CLI 主守卫传真实根）。
 */
export async function buildStories(root: string): Promise<BuildReport> {
  const sourcesDir = join(root, "Stories.src");
  const resourcesDir = join(root, "Resources");
  const storiesDir = join(resourcesDir, STORIES_DIR);

  // —— 源：恰好一个 .ts（一个工程 = 一个 Story = 一个源；多故事工程形态未支持）——
  const sources = existsSync(sourcesDir)
    ? readdirSync(sourcesDir)
        .filter((name) => name.endsWith(".ts"))
        .sort()
    : [];
  if (sources.length === 0) {
    throw new StoryBuildError(
      "Stories.src/ 下没有 .ts 源——TS 源工程需要一个 default 导出多列 Story 的源文件",
    );
  }
  if (sources.length > 1) {
    throw new StoryBuildError(
      `Stories.src/ 下发现 ${sources.length} 个 .ts 源（${sources.join("、")}）——一个工程 = 一个 Story = 一个源文件；多故事形态未定义，如需支持请先确认`,
    );
  }
  const source = sources[0]!;

  // —— cell 声明扫描（函数注册构建期提取，设计稿 §3）：Stories.src 树（排除 gen/，仅 .ts）——
  // 「名字在数据、实现在代码、build 做名字闭合」：实现住生成模块，故事 JSON 只留名字。
  const cellSourceTree = new Map<string, string>();
  for (const [rel, text] of walkFiles(sourcesDir)) {
    if (rel.startsWith("gen/") || !rel.endsWith(".ts")) continue;
    cellSourceTree.set(rel, text);
  }
  const cellScanResult = scanCells(cellSourceTree);
  if (cellScanResult.errors.length > 0) {
    throw new StoryBuildError(
      `cell 声明扫描失败：\n${cellScanResult.errors
        .map((issue) => `- ${issue.origin}：${issue.message}`)
        .join("\n")}`,
    );
  }
  const cellScan = cellScanResult.scan;

  // —— 布局声明（构建期配置，2026-10-06 补全）：列上的 `sourcePath` = 「这列住在哪个
  //    故事文件」（章节目录 / 多列成组 / `.story` 扩展名随声明）。⚠️ parseStory **刻意
  //    丢弃 sourcePath**（防自指：故事文件不描述自己的位置）⇒ 在 parse **之前**提取为
  //    构建配置、parse **之后**按 id 回填（与组装器从磁盘回填同一语义）——引擎契约零改动。
  const mod = (await import(pathToFileURL(join(sourcesDir, source)).href)) as {
    default?: unknown;
  };
  if (mod?.default === undefined) {
    throw new StoryBuildError(
      `${source}: 缺 default 导出（TS 源约定：default 导出多列 Story 值；\`satisfies Story\` 提供编译期类型检查）`,
    );
  }
  const layout = new Map<string, string>();
  {
    const rawColumns = (mod.default as { columns?: unknown }).columns;
    if (!Array.isArray(rawColumns)) {
      throw new StoryBuildError(`${source}: columns 必须为数组`);
    }
    for (const entry of rawColumns) {
      const id = (entry as { id?: unknown }).id;
      const sourcePath = (entry as { sourcePath?: unknown }).sourcePath;
      if (typeof id !== "string" || id === "") continue;
      if (sourcePath === undefined) continue;
      if (
        typeof sourcePath !== "string" ||
        !sourcePath.startsWith(`${STORIES_DIR}/`)
      ) {
        throw new StoryBuildError(
          `${source}: 列 ${id} 的 sourcePath 必须以 "${STORIES_DIR}/" 开头，收到 ${JSON.stringify(sourcePath)}`,
        );
      }
      if (sourcePath.includes("..")) {
        throw new StoryBuildError(
          `${source}: 列 ${id} 的 sourcePath 不得包含 ".."（目录逃逸）`,
        );
      }
      if (!sourcePath.endsWith(".story") && !sourcePath.endsWith(".json")) {
        throw new StoryBuildError(
          `${source}: 列 ${id} 的 sourcePath 扩展名必须是 .story 或 .json，收到 ${JSON.stringify(sourcePath)}`,
        );
      }
      layout.set(id, sourcePath);
    }
  }

  // —— 校验链入口：parseStory 与 JSON 文件同一个函数（issues 自带源名定位）——
  const story = parseStory(mod.default, `Stories.src/${source}`);
  // 布局回填（parse 之后、serialize 之前——columnFilePath 据此落章节文件）
  for (const column of story.columns) {
    const declared = layout.get(column.id);
    if (declared !== undefined) column.sourcePath = declared;
  }

  // —— 工程清单：先有 project.json（defines/shell 是工程事实，不归 TS 源管）——
  const manifestPath = join(resourcesDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new StoryBuildError(
      `Resources/${MANIFEST_FILE} 不存在——工程清单（entry/defines/shell）不归 TS 源管，请先建工程清单`,
    );
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new StoryBuildError(
      `Resources/${MANIFEST_FILE} 不是合法 JSON：${String(error)}`,
    );
  }

  // —— 扩展声明装载（对齐运行期声明制：同一份 manifest.extensions、同一个装载契约）——
  const declaredExtensions = readDeclaredExtensions(manifest);
  const loadedExtensions = await loadDeclaredExtensions(
    declaredExtensions,
    defaultExtensionLoader(root),
  );
  const extensionOpNames = new Set(
    loadedExtensions.flatMap((extension) =>
      (extension.ops ?? []).map((def) => def.op),
    ),
  );

  // —— 扩展 op 放行校验（fail-early）：运行期 unknown-op 的构建期等价判定 ——
  // 内建与已声明扩展之外出现的 op 名 = 运行期必 unknown-op ⇒ 构建期即拦截
  // （遍历含嵌套块体——if.then/while.body/func.body 内的命令同样在列；一次报全部）。
  const unknownOps = new Map<string, string[]>();
  const columnIds = story.columns.map((column) => column.id);
  walkStoryCommands(story, (cmd, pointer) => {
    const op = cmd.op;
    if (
      typeof op !== "string" ||
      BUILTIN_OP_NAMES.has(op) ||
      extensionOpNames.has(op)
    ) {
      return;
    }
    const hits = unknownOps.get(op) ?? [];
    hits.push(pointer);
    unknownOps.set(op, hits);
  });
  if (unknownOps.size > 0) {
    const at = (pointer: string): string => {
      const index = Number(/^\/columns\/(\d+)/.exec(pointer)?.[1] ?? NaN);
      const id = columnIds[index];
      return id === undefined ? pointer : `列 "${id}" ${pointer}`;
    };
    const detail = [...unknownOps.entries()]
      .map(([op, pointers]) => {
        const shown = pointers.slice(0, 3).map(at).join("、");
        const more = pointers.length > 3 ? `（共 ${pointers.length} 处）` : "";
        return `  - op "${op}" —— ${shown}${more}`;
      })
      .join("\n");
    throw new StoryBuildError(
      `故事使用了既非内建、也未被清单 extensions 声明扩展提供的 op（运行期必 unknown-op，构建期拦截）：\n${detail}\n` +
        `→ 在 Resources/${MANIFEST_FILE} 的 extensions 声明提供该 op 的扩展模块，或改用内建 op`,
    );
  }

  // —— 守卫名字闸门（cell 范式的闭合校验）：故事 guard.fn ⊆ cell 注册表键集 ——
  // fail-closed 带列与命令指针定位（编辑器不校验守卫名——构建期兜住）。
  const guardNames = new Set(cellScan.guards.map((g) => g.name));
  const unknownGuards = new Map<string, string[]>();
  walkStoryCommands(story, (cmd, pointer) => {
    if (cmd.op !== "guard") return;
    const fn = cmd.fn;
    if (typeof fn !== "string" || guardNames.has(fn)) return;
    const hits = unknownGuards.get(fn) ?? [];
    hits.push(pointer);
    unknownGuards.set(fn, hits);
  });
  if (unknownGuards.size > 0) {
    const detail = [...unknownGuards.entries()]
      .map(([fn, pointers]) => `  - guard "${fn}" —— ${pointers.join("、")}`)
      .join("\n");
    throw new StoryBuildError(
      `故事使用了未在源内 cell(...) 声明的守卫（运行期必 guard-unknown，构建期拦截）：\n${detail}\n` +
        `→ 在 Stories.src 源里用 cell("${[...unknownGuards.keys()][0]}", impl) 声明实现，或改用已声明的守卫`,
    );
  }

  // —— 编译：serializeProject = 编辑器写回同一条布局规则（单列拆分 + 清单托管键更新 + 非托管键保真）——
  const serialized = serializeProject(story, manifest);

  // —— 往返自检（编译期互锁）：产物重组回 story，再序列化必须逐字节幂等 ——
  const productManifestText = serialized.files.get(MANIFEST_FILE);
  if (productManifestText === undefined) {
    throw new StoryBuildError(
      "编译产物缺 project.json（serializeProject 契约破坏）",
    );
  }
  // assembleProject 的 files = 故事文件集（不含清单）；清单单独走 manifest 参数
  const columnFiles = new Map(serialized.files);
  columnFiles.delete(MANIFEST_FILE);
  const rebuilt = assembleProject(JSON.parse(productManifestText), columnFiles);
  const recheck = serializeProject(rebuilt, JSON.parse(productManifestText));
  for (const key of serialized.files.keys()) {
    if (recheck.files.get(key) !== serialized.files.get(key)) {
      throw new StoryBuildError(
        `编译往返自检失败（serialize → assemble → serialize 不幂等）：${key}`,
      );
    }
  }

  // —— 差量写盘：Stories/** 由源全量管理，不在产物集内的既有列文件 = 陈旧，删除 ——
  const existing = walkFiles(storiesDir);
  const written: string[] = [];
  const removed: string[] = [];
  for (const [rel, text] of serialized.files) {
    const target = join(resourcesDir, rel);
    if (existsSync(target) && readFileSync(target, "utf8") === text) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    written.push(rel);
  }
  for (const rel of existing.keys()) {
    const logical = `${STORIES_DIR}/${rel}`;
    if (serialized.files.has(logical)) continue;
    rmSync(join(storiesDir, rel), { force: true });
    removed.push(logical);
  }

  // —— 生成物：Stories.src/gen/fun_register.g.ts（幂等 + 陈旧清理；根相对路径进报告）——
  // ⚠️ 与 Stories/** 的「逻辑路径」不同命名空间：removed 里出现 Stories.src/... 即生成物。
  const genRel = "Stories.src/gen/fun_register.g.ts";
  const genTarget = join(root, genRel);
  if (cellScan.guards.length === 0) {
    if (existsSync(genTarget)) {
      rmSync(genTarget, { force: true });
      removed.push(genRel);
    }
  } else {
    const content = renderFunRegister(cellScan);
    if (!existsSync(genTarget) || readFileSync(genTarget, "utf8") !== content) {
      mkdirSync(dirname(genTarget), { recursive: true });
      writeFileSync(genTarget, content);
      written.push(genRel);
    }
  }

  // —— 词汇层轻类型校验警告（expr/cond 组装时按引擎类型规则产出）——
  // 源模块导入即完成全部表达式组装 ⇒ 此处一次性 drain；警告不拦构建，进报告由 CLI 呈现
  const warnings = [...script.drainExpressionWarnings()];

  return {
    source,
    storyId: story.id,
    columns: story.columns.length,
    written,
    removed,
    extensions: declaredExtensions,
    functions: cellScan.guards.map((g) => g.name),
    warnings,
  };
}

// —— 主模块守卫：仅直接执行时跑真实工程（tests 直测 buildStories 纯编排）——
// 可选位置参数 = 工程根（默认 = 本包根）；用法：`pnpm stories:build [工程根]`
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root =
    process.argv[2] !== undefined
      ? resolve(process.argv[2])
      : fileURLToPath(new URL("..", import.meta.url));
  try {
    const report = await buildStories(root);
    console.log(
      `TS 故事源编译完成：Stories.src/${report.source} → story "${report.storyId}"（${report.columns} 列）`,
    );
    if (report.written.length === 0 && report.removed.length === 0) {
      console.log("已是最新（零差量）");
    }
    if (report.written.length > 0) {
      console.log(
        `写入（${report.written.length}）：\n  ${report.written.join("\n  ")}`,
      );
    }
    if (report.removed.length > 0) {
      console.log(
        `清理陈旧（${report.removed.length}）：\n  ${report.removed.join("\n  ")}`,
      );
    }
    if (report.warnings.length > 0) {
      console.warn(
        `⚠ 词汇层类型提示（${report.warnings.length} 条，不拦构建——引擎求值时将 type-error）：\n${report.warnings
          .map((w) => `  - ${w.expression}：${w.message}`)
          .join("\n")}`,
      );
    }
  } catch (error) {
    console.error(
      `[stories:build] 失败：${error instanceof StoryBuildError ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

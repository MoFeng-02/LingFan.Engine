/**
 * 工程组装：project.json（工程清单）+ Stories/**（多列/单列文件）→ 组装 Story。
 * 纯函数：文件内容由平台适配器供给（WebView 无 Node——I/O 归 Rust/打包器）。
 * fail-closed：清单、文件、columnId 唯一、入口存在性任何不符 = 整次拒绝。
 */
import type { DegradedOpen, Story, StoryColumn } from "../contracts";
import { isOrientationMode, isSceneType } from "../contracts";
import {
  isSingleColumnFile,
  parseStory,
  parseStoryFile,
  StoryFormatError,
} from "./format";

export class ProjectAssemblyError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`工程组装失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "ProjectAssemblyError";
    this.issues = issues;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 确定性文件顺序（路径码元序）——defines 覆盖与列序不随 Map 构造顺序漂移 */
function byPath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 为**缺清单**的资源根合成最小降级清单（#11，2026-10-05）。
 *
 * 语义：真实工程可以没有 `project.json`（作者直接摆 Stories/）——「缺清单」
 * 只缺三件事：formatVersion（恒 1）、id（用资源根名兜底）、entry（**确定性**
 * 取路径码元序第一个列）。其余（defines / shell / extensions）缺省即正确语义。
 *
 * 🔴 **只降级「缺清单」这一种**：故事文件解析失败照常跳过（与组装器同口径，
 * 坏文件由组装器的 issues 整次拒绝）；**一个可解析的列都没有 ⇒ fail-closed**
 * ——没内容可打开时降级是撒谎。
 */
export function synthesizeDegradedManifest(
  rootName: string,
  storyTexts: ReadonlyMap<string, string>,
): { manifest: Record<string, unknown>; degraded: DegradedOpen } {
  const ids: string[] = [];
  for (const path of [...storyTexts.keys()].filter((p) => !isDotPath(p)).sort(byPath)) {
    try {
      const story = parseStoryFile(storyTexts.get(path) ?? "", path);
      for (const column of story.columns) ids.push(column.id);
    } catch {
      // 解析失败不在这里定性（组装器会收进 issues 整次拒绝）；只跳过，不采集
    }
  }
  if (ids.length === 0) {
    throw new ProjectAssemblyError([
      `降级打开失败：资源根「${rootName}」缺少 ${MANIFEST_FILE}，且 Stories/ 下没有任何可解析的列 —— 没有可打开的内容`,
    ]);
  }
  const entry = ids[0]!;
  return {
    manifest: { formatVersion: 1, id: rootName, entry },
    degraded: {
      reason: `未找到 ${MANIFEST_FILE}，已按列序第一个「${entry}」降级打开（保存后清单会落盘）`,
      entry,
    },
  };
}

/**
 * 组装工程。装载顺序：工程 defines 最先（工程默认值），文件按路径码元序，
 * 同名 define 后加载覆盖（无条件 Set 语义）。
 */
export function assembleProject(
  manifest: unknown,
  files: ReadonlyMap<string, unknown>,
): Story {
  const issues: string[] = [];
  if (!isPlainObject(manifest))
    throw new ProjectAssemblyError(["project.json: 根节点必须是对象"]);

  if (manifest.formatVersion !== 1) {
    issues.push(
      `project.json: formatVersion 必须为 1，收到 ${JSON.stringify(manifest.formatVersion)}`,
    );
  }
  if (typeof manifest.id !== "string" || manifest.id === "") {
    issues.push("project.json: id 必须为非空字符串");
  }
  if (typeof manifest.entry !== "string" || manifest.entry === "") {
    issues.push("project.json: entry 必须为非空字符串（入口列）");
  }
  if (manifest.defines !== undefined && !isPlainObject(manifest.defines)) {
    issues.push("project.json: defines 必须为对象");
  }
  if (manifest.name !== undefined && typeof manifest.name !== "string") {
    issues.push("project.json: name 必须为字符串");
  }
  if (manifest.lang !== undefined && typeof manifest.lang !== "string") {
    issues.push("project.json: lang 必须为字符串");
  }
  // 扩展声明（声明制）：须为非空字符串数组；缺席/为空 = 无扩展
  if (manifest.extensions !== undefined) {
    const declared: unknown = manifest.extensions;
    if (
      !Array.isArray(declared) ||
      declared.some((s) => typeof s !== "string" || s === "")
    ) {
      issues.push(
        "project.json: extensions 必须为非空字符串数组（宿主模块说明符）",
      );
    }
  }
  // 工程级壳配置（作者声明的作品形态）：方向非法即拒绝（fail-closed，不带病起航）
  if (manifest.shell !== undefined) {
    if (!isPlainObject(manifest.shell)) {
      issues.push("project.json: shell 必须为对象");
    } else {
      const orientation = (manifest.shell as { orientation?: unknown })
        .orientation;
      if (orientation !== undefined && !isOrientationMode(orientation)) {
        issues.push(
          `project.json: shell.orientation 必须为 auto|portrait|landscape，收到 ${JSON.stringify(orientation)}`,
        );
      }
    }
  }
  if (issues.length > 0) throw new ProjectAssemblyError(issues);

  const columns: StoryColumn[] = [];
  const owner = new Map<string, string>(); // columnId → 首个声明它的文件
  const defines: Record<string, unknown> = {
    ...((manifest.defines as Record<string, unknown> | undefined) ?? {}),
  };

  for (const path of [...files.keys()].sort(byPath)) {
    // 🔴 **只处理 `Stories/` 下的文件**（2026-10-05 治根）。
    // 此前组装器**假定**调用方只喂故事文件，于是喂了全量资源根就炸：
    // `Lang/en-US/main.json`（译文表）等全被当故事解析
    // ⇒ 「formatVersion 必须为 1」让**整个工程组装失败**。
    // 判据：非 `Stories/` 一律跳过（它们由各自的视图/工具消费，不进故事列集）。
    if (!path.startsWith(`${STORIES_DIR}/`)) continue;
    // 🔴 **占位文件不是故事**（2026-10-05 治根）：`.gitkeep` 类空文件是版本控制的占位
    // （真实工程 `Live2D/.gitkeep`、`Media/BGM/.gitkeep`），
    // 此前被当故事文件解析 ⇒ 「文本中没有 label」让整个工程组装失败。
    // 判据：**任何一段**以 `.` 开头即是（只看整路径开头会漏掉嵌套的）。
    if (isDotPath(path)) continue;
    const value = files.get(path);
    // 值的两种合法形态：解析后的文件 JSON（对象）或原始文本（JSON v1 / .story，混存由
    // parseStoryFile 识别）。组装器是**唯一解析点**——调用方只供文本，避免双重解析丢失
    // 「单列原子文件」形态而绕过文件名不变量（按 id 定位文件）。
    let story: Story;
    let atomic: boolean;
    try {
      if (typeof value === "string") {
        story = parseStoryFile(value, path);
        atomic = story.columns.length === 1; // 文本形态：单 label = 原子文件
      } else {
        story = parseStory(value, path);
        atomic = isSingleColumnFile(value);
      }
    } catch (e) {
      if (e instanceof StoryFormatError) {
        for (const issue of e.issues) issues.push(issue);
        continue;
      }
      throw e;
    }
    // 🔴 **文件名与列 id 解耦**（2026-10-05 治根，用户拍板 A）。
    //
    // 此前要求「单列文件名（去扩展名）必须等于列 id」，动机是**防错位**：
    // 文件叫 A、内容是 B ⇒ AI/编辑器「按 id 定位文件」会找错。
    // 但真实工程（`E:\langf\Downloads\Demo\Test\Resources`）用的是
    // `Stories/chapter1/chapter1.story` 装列 `chapter1_start`
    // —— **文件名是「章节名」，列 id 是「场景名」，本就是两回事**，
    // 强行相等等于禁止作者用语义化文件名。
    //
    // 现在保留原意图、只去掉耦合：**错位仍由 `columnId 重复` 守门**
    // （两个文件声明同一 id 照样拒），而「名字 ≠ id」不再被当成错误。
    // 「按 id 定位」改由 `sourcePath` 承担（组装器回填、编辑器据它写回）。
    void atomic;
    for (const column of story.columns) {
      const prev = owner.get(column.id);
      if (prev !== undefined) {
        issues.push(
          `${path}: columnId 重复：${column.id}（与 ${prev} 冲突）`,
        );
        continue;
      }
      owner.set(column.id, path);
      // 🔴 **回填来源路径**（治根·写回保真）：列从哪个文件来，就写回哪个文件。
      //
      // ⚠️ **只在「非默认路径」时显式写 `sourcePath`**：默认是 `Stories/<id>.json`，
      // 由 `columnFilePath` 隐式推导即可。显式写等于把「推导结果」存进状态，
      // 会让**新建列**（内存态无此字段）与**重开态**（有字段）不再深等 ——
      // 而「保存后重开一致」是本仓最核心的不变量之一。
      // 换言之：`sourcePath` 表达的是**例外**（作者把列放在别处），不是常态。
      const defaultPath = `${STORIES_DIR}/${column.id}.json`;
      columns.push(path === defaultPath ? column : { ...column, sourcePath: path });
    }
    Object.assign(defines, story.defines ?? {});
  }
  if (issues.length > 0) throw new ProjectAssemblyError(issues);

  const entry = manifest.entry as string;
  if (!owner.has(entry)) {
    throw new ProjectAssemblyError([
      `project.json: 入口列 ${entry} 不存在（跳转目标必须存在）`,
    ]);
  }
  return {
    formatVersion: 1,
    id: manifest.id as string,
    entry,
    columns,
    defines,
    // 扩展声明透传（宿主组合根经 `loadDeclaredExtensions` 装载后注入引擎/编辑器）
    ...(manifest.extensions !== undefined
      ? { extensions: manifest.extensions as string[] }
      : {}),
  };
}

// —— 反向：Story → 多文件工程（assembleProject 的逆函数） ——

/** 清单文件名（清单必须在资源根内——dev/prod 同机制） */
export const MANIFEST_FILE = "project.json";
/** 故事目录名（Rust `STORIES_DIR` 同名） */
export const STORIES_DIR = "Stories";

/**
 * 点文件/点目录判据（`.gitkeep` / `.gitignore` …）—— **任何一段**以 `.` 开头即是。
 *
 * 🔴 为什么按「段」而不是整路径（2026-10-05）：真实工程有 `Live2D/.gitkeep`、
 * `Media/BGM/.gitkeep` 之类嵌套占位文件（版本控制需要空目录），
 * 也有 `Lang/en-US/...`（**名字含点但不是点文件**）⇒ 只看整路径开头会漏掉嵌套的。
 */
function isDotPath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment.startsWith(".") && segment.length > 0);
}

export class ProjectSerializationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`工程写回失败（整次拒绝）：\n- ${issues.join("\n- ")}`);
    this.name = "ProjectSerializationError";
    this.issues = issues;
  }
}

/** 期望文件全集（逻辑路径相对资源根 → 完整文本；键按码元序） */
export interface SerializedProject {
  readonly files: Map<string, string>;
  /**
   * **列 id → 本次实际落盘路径**（写回回执，2026-10-05 治根）。
   *
   * 🔴 **为什么不回填进 `StoryColumn.sourcePath`**：`sourcePath` 是编辑期记账，
   * 塞进 Story 会让「内存态」与「序列化往返结果」不再深等（每次保存都多一个字段），
   * 且**重命名**时它会跟着变——但「这列落在哪个文件」是**写回的事实**，不是列的属性。
   * 归入回执 ⇒ Story 保持纯语义，往返仍深等。
   *
   * 用途：编辑器保存后据此更新自己的记账（下次保存不必再猜）。
   */
  readonly written: ReadonlyMap<string, string>;
}

export interface ProjectFileDiff {
  /** 需写入（新增或内容不同）；键按码元序 */
  readonly changes: Map<string, string>;
  /** 需删除的陈旧故事文件（仅 `Stories/**`）；码元序 */
  readonly deletes: readonly string[];
}

/** Windows/APFS 上非法的文件名字符（`: * ? " < > |` + 路径分隔符） */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/;
const MAX_FILE_NAME_SEGMENT = 200;

/**
 * 列 id 能否直接作文件名段（单列文件名 = 列 id 不变量要求）。
 * 比组装层更严：写不出合法文件就不写（fail-closed）。
 */
export function isSafeFileNameSegment(id: string): boolean {
  if (id === "" || id.length > MAX_FILE_NAME_SEGMENT) return false;
  if (id === "." || id === "..") return false; // 目录跳转
  if (id.startsWith(".")) return false; // 点文件会被枚举跳过（写下去等于自删）
  if (UNSAFE_FILE_CHARS.test(id)) return false;
  for (const ch of id) {
    if ((ch.codePointAt(0) ?? 0) < 0x20) return false; // 控制字符（不用正则，避开 no-control-regex）
  }
  if (id.endsWith(" ") || id.endsWith(".")) return false; // Windows 会静默去掉
  return true;
}

/** 确定性 JSON 文本：2 空格缩进 + 尾随单个换行（与现网工程文件同形） */
function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 单列原子文件文本：字段序固定（formatVersion, id, kind, commands|elements, entry?） */
function columnFileText(column: StoryColumn): string {
  const ordered: Record<string, unknown> = {
    formatVersion: 1,
    id: column.id,
    kind: column.kind,
  };
  // 🔴 `type`（运行语义）**必须写回**：漏了会让 menu/ui 场景在下次打开时
  // 变成 game（保存 = 悄悄改语义，且**不可逆**——作者下次打开发现菜单能回溯了）。
  // 缺省 game 不写（保持文件干净），非缺省才写。
  if (column.type !== undefined && column.type !== "game") ordered.type = column.type;
  if (column.kind === "flow") {
    ordered.commands = column.commands ?? [];
  } else {
    ordered.elements = column.elements ?? [];
    if (column.entry !== undefined) ordered.entry = column.entry;
  }
  // ⚠️ `sourcePath` **刻意不写**（编辑期元数据：它描述「这个列来自哪个文件」，
  // 写进文件内容会自指——下次打开时又变了）。
  return stableJson(ordered);
}

/**
 * 清单文本：**托管键就地更新，非托管键原值原位保留**（含未知扩展键——契约只增不改的前向兼容）。
 * defines 取合并结果（文件级 defines 上移清单级：`assembleProject` 不记录 define 来源，
 * 按文件回写不可复原；上移后「清单 define = 合并值、文件贡献为空」再组装恒等——语义等价，
 * 代价 = provenance 丢失）。空 defines 省略该键。
 */
function manifestText(
  story: Story,
  manifest: Record<string, unknown>,
): string {
  const out: Record<string, unknown> = {};
  const defines = story.defines;
  const hasDefines =
    defines !== undefined && Object.keys(defines).length > 0;
  for (const [key, value] of Object.entries(manifest)) {
    if (key === "formatVersion") {
      out[key] = 1;
    } else if (key === "id") {
      out[key] = story.id;
    } else if (key === "entry") {
      out[key] = story.entry;
    } else if (key === "defines") {
      if (hasDefines) out[key] = defines;
    } else {
      out[key] = value;
    }
  }
  // 原文缺失托管键的防御补齐（正常加载过的清单必含 formatVersion/id/entry）
  if (!("formatVersion" in out)) out.formatVersion = 1;
  if (!("id" in out)) out.id = story.id;
  if (!("entry" in out)) out.entry = story.entry;
  if (!("defines" in out) && hasDefines) out.defines = defines;
  return stableJson(out);
}

function sortByCodeUnit(files: Map<string, string>): Map<string, string> {
  return new Map([...files.entries()].sort((a, b) => byPath(a[0], b[0])));
}

/** JSON 语义相等（作者手写排版不得因重排版被当成改动；任一侧非 JSON → false，照常写入） */
function sameJsonText(a: string, b: string): boolean {
  if (a === b) return true;
  let left: unknown;
  let right: unknown;
  try {
    left = JSON.parse(a);
    right = JSON.parse(b);
  } catch {
    return false;
  }
  return deepEqualJson(left, right);
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => deepEqualJson(item, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => key in b && deepEqualJson(a[key], b[key]),
  );
}

/**
 * 序列化工程（`assembleProject` 的逆函数）：每列 → `Stories/<id>.json`（多列文件规范化成单列），
 * 加上保真的 `project.json`。任何不符 = 整次拒绝，不产半套文件（fail-closed）。
 */
export function serializeProject(
  story: Story,
  manifest: unknown,
): SerializedProject {
  if (!isPlainObject(manifest)) {
    throw new ProjectSerializationError(["project.json: 根节点必须是对象"]);
  }
  const issues: string[] = [];
  const columns = Array.isArray(story.columns) ? story.columns : [];
  if (columns.length === 0) {
    issues.push("工程至少需要一列（columns 不得为空）");
  }
  const seen = new Set<string>();
  const caseFolded = new Map<string, string>();
  for (const column of columns) {
    const id = column?.id;
    if (typeof id !== "string" || id === "") {
      issues.push("列 id 必须为非空字符串");
      continue;
    }
    if (!isSafeFileNameSegment(id)) {
      issues.push(`列 id 不能作为文件名安全使用：${JSON.stringify(id)}`);
    }
    if (seen.has(id)) {
      issues.push(`columnId 重复：${id}（columnId 全局唯一）`);
    } else {
      seen.add(id);
    }
    const folded = id.toLowerCase();
    const previous = caseFolded.get(folded);
    if (previous !== undefined && previous !== id) {
      issues.push(
        `列 id 大小写不敏感碰撞：${previous} 与 ${id}（在同一文件系统上是同一文件）`,
      );
    } else {
      caseFolded.set(folded, id);
    }
    if (column.kind !== "scene" && column.kind !== "flow") {
      issues.push(
        `列 ${id} 的 kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(column.kind)}`,
      );
      continue;
    }
    // ⚠️ `type`（运行语义）非法值同样 fail-closed——**组装器是另一条入口**（多文件工程），
    // 只在单文件解析层校验会漏掉这条路（缺省 game 合法）。
    if (column.type !== undefined && !isSceneType(column.type)) {
      issues.push(
        `列 ${id} 的 type 必须为 "game" / "menu" / "ui"，收到 ${JSON.stringify(column.type)}`,
      );
      continue;
    }
    if (column.kind === "flow" && !Array.isArray(column.commands)) {
      issues.push(`列 ${id}（flow）必须有 commands 数组`);
    }
    if (column.kind === "scene" && !Array.isArray(column.elements)) {
      issues.push(`列 ${id}（scene）必须有 elements 数组`);
    }
  }
  if (typeof story.entry !== "string" || !seen.has(story.entry)) {
    issues.push(
      `入口列 ${JSON.stringify(story.entry)} 不存在于列集`,
    );
  }
  if (issues.length > 0) throw new ProjectSerializationError(issues);

  const files = new Map<string, string>();
  // 🔴 **写回原路径**（2026-10-05 治根）：此前凭 `id` 重算 `Stories/<id>.json`，
  // 保存一次就把作者的章节目录编排 + `.story` 文本形态**抹平**，原文件还被判
  // 「陈旧」删除（探针实测 3/3 子目录文件全被删）。自我良好工程不接受。
  //
  // ⚠️ **一个文件可承载多列**（真实工程形态：`chapter1.story` 有 4 列
  // `chapter1_start` / `_explore` / `_forward` / `_end`）⇒ **按来源文件分组**写回，
  // 不是「一列一文件」。我此前误把「共享来源文件」当冲突（探针实测 62 列里
  // 大量同组⇒ 误报），真冲突只有「**同一路径被声明两次且列集不同时**」——
  // 由分组天然解决（同一列只能属于一组）。
  const byPath = new Map<string, StoryColumn[]>();
  for (const column of columns) {
    const target = columnFilePath(column);
    const bucket = byPath.get(target);
    if (bucket === undefined) byPath.set(target, [column]);
    else bucket.push(column);
  }
  for (const [target, group] of byPath) {
    files.set(target, columnGroupFileText(group, target));
  }
  if (issues.length > 0) throw new ProjectSerializationError(issues);
  files.set(MANIFEST_FILE, manifestText(story, manifest));
  // 列 id → 落盘路径（回执；与 `columnFilePath` 同口径，不另算）
  const written = new Map<string, string>();
  for (const column of columns) written.set(column.id, columnFilePath(column));
  return { files: sortByCodeUnit(files), written };
}

/**
 * 列组（**同一来源文件里的多列**）的写回文本。
 *
 * 🔴 **单列 ⇒ 保持单列原子形态**（`{formatVersion,id,kind,…}`，逐字节不变）；
 * **多列 ⇒ 写多列形态**（`{formatVersion, columns:[…]}`）——
 * 这与 `parseStoryFile` 的识别口径一致（它按内容识别两种形态），
 * 所以**往返可逆**（守卫`writeback-fidelity` 与真实工程守卫都验这一条）。
 */
function columnGroupFileText(group: readonly StoryColumn[], path: string): string {
  if (group.length === 1) return columnFileText(group[0]!);
  return stableJson({
    formatVersion: 1,
    columns: group.map((column) => {
      const ordered: Record<string, unknown> = { id: column.id, kind: column.kind };
      if (column.type !== undefined && column.type !== "game") {
        ordered.type = column.type;
      }
      if (column.kind === "flow") ordered.commands = column.commands ?? [];
      else {
        ordered.elements = column.elements ?? [];
        if (column.entry !== undefined) ordered.entry = column.entry;
      }
      return ordered;
    }),
  });
  void path;
}

/**
 * 列的写回路径：**有 `sourcePath` 就写回原处，否则新建列走 `Stories/<id>.json`**。
 *
 * 扩展名随原文件（`.story` 写回 `.story`）—— 形态也是作者的选择。
 * ⚠️ 只认**安全相对路径**（`Stories/` 前缀 + 无 `..`）：`sourcePath` 来自
 * 组装器回填，但仍当不可信输入校验（防目录逃逸）。
 */
function columnFilePath(column: StoryColumn): string {
  const raw = column.sourcePath;
  if (typeof raw !== "string" || raw === "") {
    return `${STORIES_DIR}/${column.id}.json`;
  }
  // fail-closed：越界路径直接退回默认并由调用方校验（这里先保底不生成越界路径）
  if (raw.startsWith("/") || raw.includes("..") || !raw.startsWith(`${STORIES_DIR}/`)) {
    return `${STORIES_DIR}/${column.id}.json`;
  }
  return raw;
}

/**
 * **单列文档专用写回**（资源管理器的多文档编辑面）：只产出一个列文件，**不产删除、不改清单**。
 *
 * 为何不能走 `serializeProject`：那份是**整工程**序列化器——它按「`story.columns` 即工程全列」
 * 计算期望文件集，未出现在 `columns` 里的列文件会被 `diffProjectFiles` 判为陈旧并**删除**。
 * 而单列文档由 `parseStory` 独立解析而来（资源管理器按文件懒加载），其 `columns` 只有自己一列
 * 且 `defines` / `entry` 残缺（`assembleProject` 把文件级 defines 上移清单级——见 `manifestText`
 * 注记）⇒ 走整工程路径会**删掉未编辑的其他列**。本函数是那面场景的正解：作用域 = 一个列文件。
 *
 * 清单托管键（`entry` / `defines` / `id`）由整工程保存统一负责，此处**一个字节都不碰**。
 *
 * @param story 单列文档（`parseStory` 产物；`columns` 恰一列）
 * @param columnId 目标列 id（必须是该文档所载列；不匹配 fail-closed）
 * @returns 逻辑路径 → 完整文本（恰一项）
 */
export function serializeColumnDocument(
  story: Story,
  columnId: string,
): SerializedProject {
  const columns = Array.isArray(story.columns) ? story.columns : [];
  if (columns.length !== 1) {
    throw new ProjectSerializationError([
      `单列文档写回要求文档恰载一列，收到 ${columns.length} 列`,
    ]);
  }
  const column = columns[0];
  if (column.id !== columnId) {
    throw new ProjectSerializationError([
      `单列文档写回目标不匹配：请求 ${JSON.stringify(columnId)}，文档载 ${JSON.stringify(column.id)}`,
    ]);
  }
  // 列级校验与整工程序列化同口径（kind 合法、flow 有 commands、scene 有 elements）
  const issues: string[] = [];
  if (column.kind !== "scene" && column.kind !== "flow") {
    issues.push(
      `列 ${column.id} 的 kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(column.kind)}`,
    );
  } else if (column.kind === "flow" && !Array.isArray(column.commands)) {
    issues.push(`列 ${column.id}（flow）必须有 commands 数组`);
  } else if (column.kind === "scene" && !Array.isArray(column.elements)) {
    issues.push(`列 ${column.id}（scene）必须有 elements 数组`);
  }
  if (issues.length > 0) throw new ProjectSerializationError(issues);

  // 🔴 单列写回**同样保留原路径**（与 `serializeProject` 同纪律，2026-10-05 治根）：
  // 此前固定 `Stories/<id>.json` ⇒ 编辑器保存一列就把它的章节目录拍平。
  const target = columnFilePath(column);
  return {
    files: new Map([[target, columnFileText(column)]]),
    written: new Map([[column.id, target]]),
  };
}

/**
 * 期望文件集与打开基线的最小差量：**JSON 语义比较**（解析后深等即跳过，排版差异不算改动），
 * 非 JSON（`.story` 文本形态）退化为逐字节比较；陈旧故事文件（`Stories/**` 内不在期望集）→ 删除。
 *
 * 为何一律语义比较：实测真实工程（playground `Resources/`）的故事文件与清单都不是
 * `JSON.stringify(…, 2)` 的逐字节输出（作者手写排版，如单行内联对象）——逐字节比较会让
 * **每一次保存都重写全部文件**（热重载抖动 + 静默重排版）。语义相等即跳过，作者排版得以保留。
 */
export function diffProjectFiles(
  wanted: ReadonlyMap<string, string>,
  previous: ReadonlyMap<string, string>,
): ProjectFileDiff {
  const changes = new Map<string, string>();
  for (const [path, text] of wanted) {
    const before = previous.get(path);
    if (before === undefined || !sameJsonText(before, text)) {
      changes.set(path, text);
    }
  }
  const deletes = [...previous.keys()]
    .filter((path) => path.startsWith(`${STORIES_DIR}/`) && !wanted.has(path))
    .sort(byPath);
  return { changes, deletes };
}

/** 文件指纹（FSA `File` 与 Rust `metadata` 都能给出的最小面）——写回冲突检测用 */
export interface FileStamp {
  lastModified: number;
  size: number;
}

/**
 * 写回冲突判定：
 * 打开工程的指纹快照 vs 保存时刻磁盘现状，不一致 = 外部改动会被**静默覆盖**。
 * - 基线文件**消失**（current 无此路径）→ 冲突（被外部删除）；
 * - `lastModified` / `size` 任一不同 → 冲突；
 * - 基线没有的路径（wanted 新增文件）不在检测面——新建不冲突；
 * - 写回成功后基线快照整体换新 → 自己的保存永不自报。
 */
export function detectWriteConflicts(
  baseline: ReadonlyMap<string, FileStamp>,
  current: ReadonlyMap<string, FileStamp | undefined>,
): string[] {
  const conflicts: string[] = [];
  for (const [path, stamp] of baseline) {
    const now = current.get(path);
    if (now === undefined) {
      conflicts.push(path);
      continue;
    }
    if (now.lastModified !== stamp.lastModified || now.size !== stamp.size) {
      conflicts.push(path);
    }
  }
  return conflicts;
}

/** 冲突的可操作文案（前 3 条路径 + 总数；指引两条出路） */
export function conflictMessage(paths: readonly string[]): string {
  const head = paths.slice(0, 3).join("、");
  const more = paths.length > 3 ? ` 等 ${paths.length} 个文件` : "";
  return (
    `磁盘已被外部修改（${head}${more}）：现在保存将覆盖这些改动。` +
    `请先重新打开工程确认，或放弃本次保存。`
  );
}

// —— 写回规范化的保存前检测 ——

/**
 * 保存将触发的「规范化」动作（文件级）。列序按 id 固化与 `Stories/` 空目录不清理
 * 没有文件级证据，由界面静态文案一并说明。
 */
export interface WriteNormalizationFinding {
  /** `.story` 文本形态 → 将被同名 JSON 列文件替换（内容等价转换，原文件移除） */
  readonly toConvert: readonly string[];
  /** 其余非规范文件 → 保存后将从磁盘移除（多列拆分 / 文件名与列 id 不一致 / 不再被引用） */
  readonly toRemove: readonly string[];
}

/**
 * 对比「打开时磁盘上的故事文件」与当前故事的标准布局（每列一个 `Stories/<id>.json`，
 * 与 `serializeProject` 同一布局规则），列出**保存将触发的规范化动作**。
 *
 * 判定只看路径形态（本函数与 `serializeProject`/`diffProjectFiles` 同属布局知识族）：
 * 打开时存在、标准布局里没有的文件即规范化对象——`Stories/<列id>.story` 是「转换」，
 * 其余（多列文件 / 文件名与列 id 不一致 / 不再被引用的遗留）是「移除」。
 *
 * - 输入恒不修改；`Stories/` 之外的路径不在写回白名单内，一律忽略；
 * - 不安全列 id（`isSafeFileNameSegment` 拒绝）构不出标准布局键——该列对应的磁盘文件
 *   会落入「移除」，但真保存会被 `serializeProject` 整批拒绝，检测不抢跑它的 fail-closed；
 * - 空列集 = 保存将清空 `Stories/` 的全部引用文件 → 全部「移除」（如实报告）。
 */
export function detectWriteNormalization(
  openedStoryPaths: readonly string[],
  columnIds: readonly string[],
): WriteNormalizationFinding {
  const wanted = new Set<string>();
  const idSet = new Set<string>(columnIds);
  for (const id of columnIds) {
    if (isSafeFileNameSegment(id)) {
      wanted.add(`${STORIES_DIR}/${id}.json`);
    }
  }
  const toConvert: string[] = [];
  const toRemove: string[] = [];
  for (const path of openedStoryPaths) {
    if (!path.startsWith(`${STORIES_DIR}/`) || wanted.has(path)) continue;
    const base = path.slice(STORIES_DIR.length + 1);
    const dot = base.lastIndexOf(".");
    const seg = dot > 0 ? base.slice(0, dot) : "";
    if (base.endsWith(".story") && seg !== "" && idSet.has(seg)) {
      toConvert.push(path);
    } else {
      toRemove.push(path);
    }
  }
  return {
    toConvert: toConvert.sort(byPath),
    toRemove: toRemove.sort(byPath),
  };
}

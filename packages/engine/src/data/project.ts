/**
 * 工程组装：project.json（工程清单）+ Stories/**（多列/单列文件）→ 组装 Story。
 * 纯函数：文件内容由平台适配器供给（WebView 无 Node——I/O 归 Rust/打包器）。
 * fail-closed：清单、文件、columnId 唯一、入口存在性任何不符 = 整次拒绝。
 */
import type { Story, StoryColumn } from "../contracts";
import { isOrientationMode } from "../contracts";
import {
  baseName,
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
    const value = files.get(path);
    // 值的两种合法形态：解析后的文件 JSON（对象）或原始文本（JSON v1 / .story，T4 混存由
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
    // 单列原子文件：文件名（去扩展名）必须等于列 id——AI/编辑器「按 id 定位文件」的不变量
    // （I18N 多语言文件名 {id}_{lang} 豁免随多语言机制落地时引入）
    const first = story.columns[0];
    if (atomic && first !== undefined && first.id !== baseName(path)) {
      issues.push(
        `${path}: 单列文件名（${baseName(path)}）必须等于列 id（${first.id}）`,
      );
      continue;
    }
    for (const column of story.columns) {
      const prev = owner.get(column.id);
      if (prev !== undefined) {
        issues.push(
          `${path}: columnId 重复：${column.id}（与 ${prev} 冲突）`,
        );
        continue;
      }
      owner.set(column.id, path);
      columns.push(column);
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

// —— 09-16 反向：Story → 多文件工程（assembleProject 的逆函数） ——

/** 清单文件名（清单必须在资源根内——dev/prod 同机制） */
export const MANIFEST_FILE = "project.json";
/** 故事目录名（Rust `STORIES_DIR` 同名） */
export const STORIES_DIR = "Stories";

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
  if (column.kind === "flow") {
    ordered.commands = column.commands ?? [];
  } else {
    ordered.elements = column.elements ?? [];
    if (column.entry !== undefined) ordered.entry = column.entry;
  }
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
  for (const column of columns) {
    files.set(`${STORIES_DIR}/${column.id}.json`, columnFileText(column));
  }
  files.set(MANIFEST_FILE, manifestText(story, manifest));
  return { files: sortByCodeUnit(files) };
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

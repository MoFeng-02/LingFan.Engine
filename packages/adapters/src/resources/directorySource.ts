/**
 * 编辑器工程供给（浏览器形态）：**目录取径**两类——File System Access 真目录句柄
 * （Chromium：可枚举、可读、可写）与目录 input 的只读文件快照
 * （`<input webkitdirectory>`，全浏览器兜底）。两类共用同一组端口实现，
 * **`ProjectFilesPort` / `ResourcePort` 契约零改动**。
 *
 * 逻辑路径一律相对**资源根**（含 `project.json` 的那一层）——与 fetch / Tauri 两种
 * 供给实现的键完全一致（组装器是唯一解析点，本模块只负责「取」）。
 * 枚举口径照 Rust `collect_story_files`：`Stories/**` 递归、跳过点文件名、不设扩展名白名单。
 * **唯一有意差异 = 加密形态**：`.enc` 需密钥解密（安全边界在 Rust）→ 浏览器形态
 * 显式 fail-closed，不猜、不跳过；形态判定**唯一落在 `encryptedProject` 模块**（前置、
 * 统一文案）——将来编辑器桌面壳落地时只换判定点之后的供给，规则不重写。
 *
 * 资源供给 = 文件对象 → 短生命周期 Blob URL（Blob URL 用后 revoke），
 * `release` 即 revoke——与加密适配器同一契约形态（静态根与加密形态各自空实现/归 Rust）。
 *
 * **写回**：仅 FSA 取径可写（`createHandleProjectWriter`）——打开时仍只申请 `read`，
 * 保存时（按钮点击 = 真实用户手势）才申请 `readwrite`；目录 input 快照无写权限，宿主据
 * `writable` 禁用保存。写回顺序固定「先写后删」，永不先删后写。
 */
import {
  conflictMessage,
  detectWriteConflicts,
  diffProjectFiles,
  MANIFEST_FILE,
  STORIES_DIR,
  synthesizeDegradedManifest,
  type DegradedOpen,
  type FileStamp,
  type ProjectFilesPort,
  type ProjectWriteReport,
  type ProjectWriterPort,
  type ResourcePort,
} from "@lingfan/engine";
import {
  detectEncryptedProject,
  encryptedProjectMessage,
} from "./encryptedProject";
import { normalizeResourceId } from "./resourcePort";

/**
 * 目录取径的统一供给面：逻辑路径 → 原始文本 / 文件对象。
 * 两类取径各一实现（FSA 句柄 / 目录 input 文件表），端口构造只依赖此面。
 */
export interface ProjectFileSource {
  /** 资源根名（诊断与界面显示；FSA = 句柄名，文件表 = 路径前缀末段） */
  readonly name: string;
  /** 资源根内全部文件逻辑路径（`/` 分隔、字典序确定、已跳点文件） */
  paths(): Promise<readonly string[]>;
  /** 按逻辑路径读原始文本（UTF-8；不存在/不可读必须抛错，不静默降级） */
  text(path: string): Promise<string>;
  /** 按逻辑路径取文件对象（Blob URL 供给用；不存在必须抛错） */
  file(path: string): Promise<File>;
}

/** 点文件/点目录（任何一层）：资源根里 `.*` 一律不是工程内容（Rust 跳点文件同口径，目录一并跳） */
function isDotName(name: string): boolean {
  return name.startsWith(".");
}

function segmentDepth(path: string): number {
  return path.split("/").length;
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at + 1);
}

// —— 取径一：File System Access 目录句柄 ——

/** 目录选择器（`showDirectoryPicker` 尚未进 lib.dom：只声明我们用到的这一面） */
interface DirectoryPickerHost {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

function pickerHost(): DirectoryPickerHost {
  return window as unknown as DirectoryPickerHost;
}

/** FSA 取径是否可用（不可用 → 宿主应走目录 input 兜底） */
export function supportsDirectoryPicker(): boolean {
  return typeof pickerHost().showDirectoryPicker === "function";
}

/**
 * 选择工程目录（必须由用户手势触发）。用户取消 → `undefined`（不视作错误）；
 * 其余失败原样抛出（权限/平台异常不吞）。
 */
export async function pickProjectDirectory(): Promise<
  FileSystemDirectoryHandle | undefined
> {
  const pick = pickerHost().showDirectoryPicker;
  if (pick === undefined) return undefined;
  try {
    // mode=read：打开只要读权限；写权限留到「保存」时按需申请（不提前要权限）
    return await pick.call(window, { id: "lingfan-project", mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return undefined;
    }
    throw error;
  }
}

/** 句柄缺失（未找到/类型不符）判定：其余异常（权限等）不吞 */
function isMissingHandle(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}

async function tryFileHandle(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemFileHandle | undefined> {
  try {
    return await dir.getFileHandle(name);
  } catch (error) {
    if (isMissingHandle(error)) return undefined;
    throw error;
  }
}

async function tryDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await dir.getDirectoryHandle(name);
  } catch (error) {
    if (isMissingHandle(error)) return undefined;
    throw error;
  }
}

/**
 * 资源根定位（FSA）：所选目录含清单即资源根；否则下探一层 `Resources/`
 * （工程惯例里资源根就在该子目录）。都无清单但有 `Stories/` ⇒ **缺清单的合法资源根**
 * （`readProject` 会合成最小清单并显式回执）。都没有 → fail-closed 报可操作的话。
 */
async function locateResourceRootHandle(
  picked: FileSystemDirectoryHandle,
): Promise<{ root: FileSystemDirectoryHandle; name: string }> {
  if ((await tryFileHandle(picked, MANIFEST_FILE)) !== undefined) {
    return { root: picked, name: picked.name };
  }
  const resources = await tryDirectoryHandle(picked, "Resources");
  if (
    resources !== undefined &&
    (await tryFileHandle(resources, MANIFEST_FILE)) !== undefined
  ) {
    return { root: resources, name: resources.name };
  }
  // 降级候选：无清单但有 Stories/（缺清单只是缺 formatVersion/id/entry，合成即可）
  if ((await tryDirectoryHandle(picked, STORIES_DIR)) !== undefined) {
    return { root: picked, name: picked.name };
  }
  if (
    resources !== undefined &&
    (await tryDirectoryHandle(resources, STORIES_DIR)) !== undefined
  ) {
    return { root: resources, name: resources.name };
  }
  throw new Error(
    `所选目录（${picked.name}）内未找到 ${MANIFEST_FILE} 或 ${STORIES_DIR}/：请选择工程资源根（含 ${MANIFEST_FILE} 或 ${STORIES_DIR}/ 的目录）`,
  );
}

async function walkHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  into: string[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (isDotName(entry.name)) continue;
    if (entry.kind === "file") {
      into.push(`${prefix}${entry.name}`);
      continue;
    }
    await walkHandle(entry, `${prefix}${entry.name}/`, into);
  }
}

/**
 * 目录句柄取径（Chromium FSA）：只枚举**资源根之内**（不扫所选目录的整棵子树，
 * 避免误选上层目录时白扫一堆无关文件）。
 */
export async function createHandleFileSource(
  picked: FileSystemDirectoryHandle,
): Promise<ProjectFileSource> {
  const { root, name } = await locateResourceRootHandle(picked);
  let listing: Promise<readonly string[]> | null = null;
  const list = (): Promise<readonly string[]> => {
    listing ??= (async () => {
      const out: string[] = [];
      await walkHandle(root, "", out);
      return out.sort(); // 路径码元序确定（组装器前的确定性要求）
    })();
    return listing;
  };
  const resolveHandle = async (
    path: string,
  ): Promise<FileSystemFileHandle> => {
    const segments = normalizeResourceId(path).split("/");
    let dir: FileSystemDirectoryHandle = root;
    for (const segment of segments.slice(0, -1)) {
      const next = await tryDirectoryHandle(dir, segment);
      if (next === undefined) throw new Error(`资源不存在：${path}`);
      dir = next;
    }
    const file = await tryFileHandle(dir, segments[segments.length - 1] ?? "");
    if (file === undefined) throw new Error(`资源不存在：${path}`);
    return file;
  };
  return {
    name,
    paths: list,
    async text(path: string): Promise<string> {
      const file = await resolveHandle(path);
      return (await file.getFile()).text();
    },
    async file(path: string): Promise<File> {
      const file = await resolveHandle(path);
      return file.getFile();
    },
  };
}

// —— 取径二：目录 input 的只读文件快照 ——

/** 目录 input 给的相对路径（`webkitRelativePath`；缺省退回文件名） */
function relativePathOf(file: File): string {
  const raw = (file as { webkitRelativePath?: string }).webkitRelativePath;
  const path = raw !== undefined && raw !== "" ? raw : file.name;
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * 资源根定位（文件快照）：清单所在层即资源根（清单必须在资源根内的推论）。
 * 同深出现多个清单 = 无法判定 → fail-closed 让用户直接选资源根，不替用户猜。
 * 降级：无清单时以 `Stories/` 目录定位资源根（`readProject` 合成清单并显式回执）；
 * 连 Stories/ 都没有才 fail-closed。
 */
export function locateResourceRootFromPaths(paths: readonly string[]): {
  /** 资源根前缀（`""` 或 `Resources/`） */
  root: string;
  /** 清单逻辑路径（资源根相对；**缺清单时是期望位置**，存在与否由 readProject 判定） */
  manifest: string;
} {
  const candidates = paths.filter(
    (path) => path === MANIFEST_FILE || path.endsWith(`/${MANIFEST_FILE}`),
  );
  if (candidates.length > 0) {
    const sorted = [...candidates].sort((a, b) => {
      const depth = segmentDepth(a) - segmentDepth(b);
      return depth !== 0 ? depth : a.localeCompare(b);
    });
    const first = sorted[0] ?? MANIFEST_FILE;
    const ambiguous = sorted.filter(
      (path) =>
        segmentDepth(path) === segmentDepth(first) && dirOf(path) !== dirOf(first),
    );
    if (ambiguous.length > 0) {
      throw new Error(
        `发现多个 ${MANIFEST_FILE}（${first}、${ambiguous[0] ?? ""}）：请直接选择工程资源根目录`,
      );
    }
    return { root: dirOf(first), manifest: MANIFEST_FILE };
  }
  // 降级：无清单 ⇒ 以 Stories/ 目录定位资源根（同层多个 = 无法判定，fail-closed）
  const storyRoots = new Set<string>();
  for (const path of paths) {
    if (path.startsWith(`${STORIES_DIR}/`)) storyRoots.add("");
    else {
      const marker = `/${STORIES_DIR}/`;
      const idx = path.indexOf(marker);
      if (idx >= 0) storyRoots.add(path.slice(0, idx + 1));
    }
  }
  if (storyRoots.size === 0) {
    throw new Error(
      `所选目录内未找到 ${MANIFEST_FILE} 或 ${STORIES_DIR}/：请选择工程资源根（含 ${MANIFEST_FILE} 或 ${STORIES_DIR}/ 的目录）`,
    );
  }
  if (storyRoots.size > 1) {
    throw new Error(
      `发现多个 ${STORIES_DIR}/ 目录（${[...storyRoots].map((r) => `${r || "根层"}${STORIES_DIR}`).join("、")}）：请直接选择工程资源根目录`,
    );
  }
  return { root: [...storyRoots][0] ?? "", manifest: MANIFEST_FILE };
}

/** 目录 input 取径：路径剥资源根前缀，文件按逻辑路径查表 */
export async function createFileListFileSource(
  files: readonly File[],
): Promise<ProjectFileSource> {
  const entries = new Map<string, File>();
  for (const file of files) {
    const path = relativePathOf(file);
    const segments = path.split("/");
    const last = segments[segments.length - 1] ?? "";
    if (isDotName(last)) continue;
    entries.set(path, file);
  }
  const { root } = locateResourceRootFromPaths([...entries.keys()]);
  const rootSegments = root === "" ? [] : root.replace(/\/$/, "").split("/");
  const rootName = rootSegments[rootSegments.length - 1] ?? "Resources";
  const relative = new Map<string, File>();
  const all = [...entries.entries()];
  for (const [path, file] of all) {
    const segments = path.split("/");
    if (segments.length <= rootSegments.length) continue;
    const prefix = segments.slice(0, rootSegments.length).join("/");
    if (prefix !== root.replace(/\/$/, "")) continue;
    relative.set(segments.slice(rootSegments.length).join("/"), file);
  }
  const paths = [...relative.keys()].sort();
  const lookup = (path: string): File => {
    const file = relative.get(normalizeResourceId(path));
    if (file === undefined) throw new Error(`资源不存在：${path}`);
    return file;
  };
  return {
    name: rootName,
    async paths(): Promise<readonly string[]> {
      return paths;
    },
    async text(path: string): Promise<string> {
      return lookup(path).text();
    },
    async file(path: string): Promise<File> {
      return lookup(path);
    },
  };
}

// —— 端口构造（两类取径共用） ——

/**
 * `ProjectFilesPort` 实现：一次装载 memo（失败粘滞 fail-closed，不降级空工程——
 * 与 Tauri 供给同语义；编辑器把「打开工程」当快照，不隐式改读磁盘）。
 */
export function createSourceProjectFilesPort(
  source: ProjectFileSource,
): ProjectFilesPort {
  let loaded: Promise<{
    manifest: unknown;
    stories: Map<string, string>;
    degraded: DegradedOpen | undefined;
  }> | null = null;
  const load = (): Promise<{
    manifest: unknown;
    stories: Map<string, string>;
    degraded: DegradedOpen | undefined;
  }> => {
    loaded ??= readProject(source);
    return loaded;
  };
  return {
    async manifest(): Promise<unknown> {
      return (await load()).manifest;
    },
    async stories(): Promise<Map<string, string>> {
      return new Map((await load()).stories);
    },
    async degraded(): Promise<DegradedOpen | undefined> {
      // 与 manifest()/stories() 共享同一次装载 memo（幂等）；缺清单 = 合成回执，否则 undefined
      return (await load()).degraded;
    },
  };
}

async function readProject(
  source: ProjectFileSource,
): Promise<{
  manifest: unknown;
  stories: Map<string, string>;
  degraded: DegradedOpen | undefined;
}> {
  const paths = await source.paths();
  // 加密形态**前置统一识别**（唯一判定点，见 encryptedProject）：在读取任何文件之前拒绝——
  // 逐个路径在循环里抛会把「工程形态问题」报成「某个文件的问题」，且已白读一批文件。
  const encrypted = detectEncryptedProject(paths);
  if (encrypted.encrypted) {
    throw new Error(encryptedProjectMessage(source.name, encrypted));
  }
  const hasManifest = paths.includes(MANIFEST_FILE);
  const storyPaths = paths.filter((path) => path.startsWith(`${STORIES_DIR}/`));
  if (storyPaths.length === 0) {
    // 只降级「缺清单」这一种：连 Stories/ 都没有 = 没有可打开的内容，照旧 fail-closed
    throw new Error(
      hasManifest
        ? `资源根（${source.name}）缺少 ${STORIES_DIR}/ 目录`
        : `资源根（${source.name}）缺少 ${MANIFEST_FILE} 且没有 ${STORIES_DIR}/ 目录：没有可打开的内容`,
    );
  }
  const stories = new Map<string, string>();
  for (const path of storyPaths) {
    stories.set(path, await source.text(path));
  }
  if (!hasManifest) {
    // 降级：合成最小清单（formatVersion/id/entry），降级事实显式上交（端口 `degraded()`）
    const { manifest, degraded } = synthesizeDegradedManifest(source.name, stories);
    return { manifest, stories, degraded };
  }
  const raw = await source.text(MANIFEST_FILE);
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (error: unknown) {
    // 清单**存在但损坏** = 结构问题，照旧 fail-closed（可降级的只有「缺失」）
    throw new Error(`${MANIFEST_FILE} 不是合法 JSON：${String(error)}`);
  }
  return { manifest, stories, degraded: undefined };
}

/** Blob URL 构造/释放（缺省 `URL.createObjectURL`；测试以契约替身注入） */
export interface BlobUrlOptions {
  createObjectURL?: (file: File) => string;
  revokeObjectURL?: (url: string) => void;
}

/**
 * `ResourcePort` 实现：逻辑路径 → 文件对象 → Blob URL（同路径复用同一 URL，
 * `release` 才 revoke）。解析失败必须抛错——调用方 fail-closed 不播放/不显示。
 */
export function createSourceResourcePort(
  source: ProjectFileSource,
  options: BlobUrlOptions = {},
): ResourcePort {
  const create = options.createObjectURL ?? ((file: File) => URL.createObjectURL(file));
  const revoke = options.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  /** 逻辑路径 → 已解析 URL（release 时反查并清空） */
  const resolved = new Map<string, string>();
  const inFlight = new Map<string, Promise<string>>();
  return {
    async resolve(id: string): Promise<string> {
      const path = normalizeResourceId(id);
      const cached = resolved.get(path);
      if (cached !== undefined) return cached;
      const pending = inFlight.get(path);
      if (pending !== undefined) return pending;
      const task = source.file(path).then((file) => {
        const url = create(file);
        resolved.set(path, url);
        inFlight.delete(path);
        return url;
      });
      inFlight.set(path, task);
      try {
        return await task;
      } catch (error: unknown) {
        inFlight.delete(path); // 失败不粘滞：允许修好资源后重试
        throw error;
      }
    },
    release(url: string): void {
      for (const [path, known] of resolved) {
        if (known !== url) continue; // 只释放本端口产出的 URL
        resolved.delete(path);
        revoke(url);
        return;
      }
    },
  };
}

// —— 诊断供给侧：i18n overlay 键 + 资源文件集 ——

/** overlay 根目录名（Rust `LANG_ROOT` 同名） */
const LANG_ROOT = "Lang";

/** 编辑器诊断的两份供给侧数据（= `analyzeStory` 的可选入参形态） */
export interface DiagnosticSupply {
  /** 资源根内实际文件的**逻辑路径**集合（相对资源根，原样） */
  resourceFiles: ReadonlySet<string>;
  /** overlay 译文键并集（`Lang/**` 全部语言；无 `Lang/` = 空集） */
  overlayKeys: ReadonlySet<string>;
  /**
   * **按语言分组**的 overlay 键（本地化工作台用；契约**只增**）。
   *
   * 为何与 `overlayKeys` 并存而不替换：诊断的「多余译文」判据要的是**并集**口径
   * （任一语言多译即报），而工作台要的是**逐语言**口径（每个语言各自缺哪些）
   * ⇒ 两种口径都是对的，合成一个会毁掉其中一个。
   *
   * 键 = 语言码（目录形态 `Lang/{lang}/**` 取 `{lang}`；单文件 `Lang/{lang}.json` 取文件名）。
   */
  overlayKeysByLang: ReadonlyMap<string, ReadonlySet<string>>;
}

/** 从 overlay 逻辑路径取语言码（`Lang/en/main.json` → `en`；`Lang/en.json` → `en`） */
export function langOfOverlayPath(path: string): string | undefined {
  if (!isOverlayPath(path)) return undefined;
  const rest = path.slice(`${LANG_ROOT}/`.length).replace(/\.json(\.enc)?$/, "");
  // 目录形态取首段、单文件形态整段就是语言码（`rest` 内不含 `/` 时即单文件）
  const head = rest.split("/")[0] ?? "";
  return head === "" ? undefined : head;
}

/** overlay 候选文件：`Lang/` 下、`.json` 或 `.json.enc` 结尾（点文件已由枚举口径剔除） */
function isOverlayPath(path: string): boolean {
  return (
    path.startsWith(`${LANG_ROOT}/`) &&
    (path.endsWith(".json") || path.endsWith(".json.enc"))
  );
}

/**
 * overlay 译文表解析（Rust `load_overlay_files` 同语义）：**坏 JSON / 含非字符串值 →
 * 整个文件跳过**（宽松口径：少报不误报）。返回 `undefined` = 跳过。
 */
function parseOverlayEntries(text: string): Record<string, string> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") return undefined; // 非字符串值 = 整文件无效（不部分采用）
    entries[key] = raw;
  }
  return entries;
}

/**
 * 编辑器诊断供给侧：一次枚举算出两份数据，供 `analyzeStory`
 * 的 `resourceFiles` / `overlayKeys` 使用（编辑器**唯一**接线点 = 组合根调用本函数）。
 *
 * `resourceFiles` = `paths()` **原样全集**（含清单/故事/Lang 属无害冗余，只令 `has()` 为真）。
 * **有意不做 `.enc` 后缀特判**：编辑器是**明文工程形态**（
 * `.enc` 故事在打开时已 fail-closed）⇒ 能打开的工程里运行期解析 = 明文名字直查
 * （`createStaticResourcePort.resolve`，无任何 `.enc` 探测），剥后缀反而制造
 * 「编辑器说在、运行期说缺」的分叉；加密工程编辑器打不开，剥不剥都无意义。
 * **有意不读文件头判加密**：LFEN/LFEN2 魔数知识归 Rust（安全边界在 Rust 层），
 * 且运行期逻辑路径定义与内容格式无关（明文 `.enc` 文件运行期走 BadFormat，不当明文用）——
 * 读头既换不来对齐、还把格式知识引入 TS + 每文件多一次 I/O。
 *
 * `overlayKeys` = `Lang/**` 下全部 `.json`（目录形态 `Lang/{lang}/**` 与单文件
 * `Lang/{lang}.json` 两种写法都命中）的键**并集**。与 Rust 供给的差异说明：Rust 按 `lang`
 * 单语言供给，而「译文键在故事里找不到原文」与语言无关 ⇒ 编辑器取**跨语言并集**才能覆盖
 * 所有死键（编辑器暂无语言选择器；单语言口径在只有 `en/` 而无 `zh-CN/` 的工程上会整体失效）。
 * 加密 overlay（`.json.enc`）**走同一供给参与对账**：能解密的供给（如
 * Tauri 形态的 `text` 经 Rust 返回明文）正常入集；浏览器形态无密钥，密文 JSON
 * 解析失败 → `parseOverlayEntries` 宽容跳过——与「单文件内容坏」同语义，少报不误报。
 *
 * 失败语义：枚举/读取失败**原样抛出**（不静默降级空集合——半套数据会让诊断假绿）；
 * 单文件内容坏则宽容跳过（与 Rust 一致，见 `parseOverlayEntries`）。
 */
export async function loadDiagnosticSupply(
  source: ProjectFileSource,
): Promise<DiagnosticSupply> {
  const paths = await source.paths();
  const resourceFiles = new Set<string>();
  const overlayKeys = new Set<string>();
  const overlayKeysByLang = new Map<string, Set<string>>();
  for (const path of paths) {
    resourceFiles.add(path);
    if (!isOverlayPath(path)) continue;
    const entries = parseOverlayEntries(await source.text(path));
    if (entries === undefined) continue;
    const lang = langOfOverlayPath(path);
    for (const key of Object.keys(entries)) {
      overlayKeys.add(key);
      // 语言码取不出（理论上不该发生：isOverlayPath 已限定形态）⇒ 键进并集但不进分组，
      // 宁可工作台少显示一个语言，也不把键算到错误语言名下。
      if (lang === undefined) continue;
      const bucket = overlayKeysByLang.get(lang) ?? new Set<string>();
      bucket.add(key);
      overlayKeysByLang.set(lang, bucket);
    }
  }
  return { resourceFiles, overlayKeys, overlayKeysByLang };
}

// —— 写回：FSA 目录句柄 ——

/** 未获写权限时的统一可操作文案（requestPermission 被拒 / createWritable 抛 NotAllowedError 同一句） */
const WRITE_PERMISSION_HINT =
  "未获得写入权限：请重新点击「打开工程」选择该目录，并在浏览器询问时选择「允许编辑」";

/** 可写文件句柄（lib.dom 版本不一：只声明我们用到的这一面） */
interface WritableFileHost {
  createWritable(options?: { keepExistingData?: boolean }): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

/** 可写目录句柄（建文件/建目录/删除/权限查询——一律窄化，避免 lib 漂移） */
interface WritableDirectoryHost {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemFileHandle>;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor?: {
    mode?: "read" | "readwrite";
  }): Promise<PermissionState>;
}

function asWritableDir(handle: FileSystemDirectoryHandle): WritableDirectoryHost {
  return handle as unknown as WritableDirectoryHost;
}

function asWritableFile(handle: FileSystemFileHandle): WritableFileHost {
  return handle as unknown as WritableFileHost;
}

/** 写权限被拒的两种表现归一（用户可见文案不分叉） */
function normalizeWriteError(error: unknown): unknown {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return new Error(WRITE_PERMISSION_HINT);
  }
  return error;
}

/**
 * 申请写权限：`queryPermission` 已 granted 直接放行；否则 `requestPermission`。
 * **必须是 `apply()` 里第一个 await**——保存按钮点击是真实用户手势，浏览器要求
 * transient activation 才能弹权限询问；先做别的异步再申请会被拒。
 * 老 Chromium 无 permission API：不预检，由 `createWritable` 的 NotAllowedError 归一。
 */
async function ensureWriteAccess(root: FileSystemDirectoryHandle): Promise<void> {
  const dir = asWritableDir(root);
  if (dir.queryPermission !== undefined) {
    if ((await dir.queryPermission({ mode: "readwrite" })) === "granted") return;
  }
  if (dir.requestPermission !== undefined) {
    const state = await dir.requestPermission({ mode: "readwrite" });
    if (state === "granted") return;
    throw new Error(WRITE_PERMISSION_HINT);
  }
}

/** 逻辑路径 → 安全段（复用资源路径口径：剥前导斜杠、拒空段与 `..` 逃逸） */
function safeSegments(path: string): string[] {
  const segments = normalizeResourceId(path).split("/");
  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.includes("\\")) {
      throw new Error(`工程路径非法（越出资源根）：${path}`);
    }
  }
  return segments;
}

/** 写入单个文件（中间目录缺则创建；失败 abort 不落半截） */
async function writeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<void> {
  const segments = safeSegments(path);
  let dir = asWritableDir(root);
  for (const segment of segments.slice(0, -1)) {
    dir = asWritableDir(await dir.getDirectoryHandle(segment, { create: true }));
  }
  const file = await dir.getFileHandle(segments[segments.length - 1] ?? "", {
    create: true,
  });
  const writable = await asWritableFile(file).createWritable();
  try {
    await writable.write(text);
    await writable.close();
  } catch (error: unknown) {
    await writable.abort();
    throw error;
  }
}

/** 删除单个文件（缺失 = 已删，幂等；目录缺失同样吞掉） */
async function removeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<void> {
  const segments = safeSegments(path);
  let dir = asWritableDir(root);
  for (const segment of segments.slice(0, -1)) {
    let next: FileSystemDirectoryHandle;
    try {
      next = await dir.getDirectoryHandle(segment);
    } catch (error: unknown) {
      if (isMissingHandle(error)) return;
      throw error;
    }
    dir = asWritableDir(next);
  }
  try {
    await dir.removeEntry(segments[segments.length - 1] ?? "");
  } catch (error: unknown) {
    if (isMissingHandle(error)) return;
    throw error;
  }
}

/** 采集文件指纹：逻辑路径 → lastModified/size；缺失/不可读的路径**不入表**
 *  （load 侧 undefined = 冲突判定为「被外部删除」；采集异常不吞 IO 错误以外的致命问题）。 */
async function collectFileStamps(
  root: FileSystemDirectoryHandle,
  paths: readonly string[],
): Promise<Map<string, FileStamp>> {
  const stamps = new Map<string, FileStamp>();
  for (const path of paths) {
    try {
      let dir: FileSystemDirectoryHandle = root;
      const segments = safeSegments(path);
      for (const segment of segments.slice(0, -1)) {
        dir = await asWritableDir(dir).getDirectoryHandle(segment);
      }
      const handle = await asWritableDir(dir).getFileHandle(
        segments[segments.length - 1] ?? "",
      );
      const file = await handle.getFile();
      stamps.set(path, {
        lastModified: file.lastModified,
        size: file.size,
      });
    } catch (error: unknown) {
      if (isMissingHandle(error)) continue; // 缺失 = 留空（比对时判冲突）
      throw error;
    }
  }
  return stamps;
}

/**
 * `ProjectWriterPort` 实现（FSA 真目录）：与**打开基线**求最小差量 → 先写后删。
 *
 * 顺序固定：申请写权限 → **冲突检测** → 建 `Stories/` → 写列文件 → 写 `project.json` → 删陈旧文件。
 * 永不先删后写：任一步失败时磁盘上最坏只是「多出文件」，工程仍可加载；失败不更新基线，
 * 重试即幂等收敛。
 *
 * **并发检测**：构造时对基线文件集采集指纹（`getFile()` → lastModified/size），
 * 每次 `apply` 在落盘前重新采集比对——外部改动/删除 → 抛可操作冲突错误（零写入）；
 * 写回成功后快照整体换新（自己的保存永不自报）。读指纹只需 read 权限（打开时已获）。
 */
export async function createHandleProjectWriter(
  picked: FileSystemDirectoryHandle,
  previous: ReadonlyMap<string, string>,
): Promise<ProjectWriterPort> {
  const { root } = await locateResourceRootHandle(picked);
  let baseline = new Map(previous);
  let stamps = await collectFileStamps(root, [...baseline.keys()]);
  return {
    writable: true,
    async apply(files: ReadonlyMap<string, string>): Promise<ProjectWriteReport> {
      const { changes, deletes } = diffProjectFiles(files, baseline);
      const written: string[] = [];
      const deleted: string[] = [];
      try {
        await ensureWriteAccess(root); // 手势窗口：保持为第一个 await
        // 冲突检测：任何落盘之前重采指纹比对（读只需 read 权限，不弹权限）
        const current = await collectFileStamps(root, [...stamps.keys()]);
        const conflicts = detectWriteConflicts(stamps, current);
        if (conflicts.length > 0) {
          throw new Error(conflictMessage(conflicts));
        }
        // `Stories/` 可能不存在（首次写回 / 用户清空）→ 建之
        await asWritableDir(root).getDirectoryHandle(STORIES_DIR, {
          create: true,
        });
        // 列文件先写，`project.json` 最后写（= 提交点：入口列改名在删除前已指向新 id）
        const columnPaths = [...changes.keys()].filter(
          (path) => path !== MANIFEST_FILE,
        );
        const manifestText = changes.get(MANIFEST_FILE);
        const ordered =
          manifestText === undefined
            ? columnPaths
            : [...columnPaths, MANIFEST_FILE];
        for (const path of ordered) {
          await writeFileAt(root, path, changes.get(path) ?? "");
          written.push(path);
        }
        for (const path of deletes) {
          await removeFileAt(root, path);
          deleted.push(path);
        }
      } catch (error: unknown) {
        throw normalizeWriteError(error);
      }
      baseline = new Map(files); // 成功才更新基线 → 二次保存不重复写
      stamps = await collectFileStamps(root, [...baseline.keys()]); // 快照换新：自己的保存不自报
      return { written, deleted };
    },
  };
}

// —— 「记住上次工程」——

/**
 * 读权限按需申请（「重新打开上次工程」用）：已授权直接放行；未授权在**用户手势内**
 * 申请 `read`（重开按钮点击即手势，与保存链路 `ensureWriteAccess` 同一约束）。
 * 部分 Chromium 无 permission API：放行（由后续文件读失败归一）。
 */
export async function ensureReadAccess(
  root: FileSystemDirectoryHandle,
): Promise<boolean> {
  const dir = root as FileSystemDirectoryHandle & {
    queryPermission?: (options: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
    requestPermission?: (options: {
      mode: "read" | "readwrite";
    }) => Promise<PermissionState>;
  };
  if (dir.queryPermission !== undefined) {
    if ((await dir.queryPermission({ mode: "read" })) === "granted") return true;
  }
  if (dir.requestPermission === undefined) return true;
  return (await dir.requestPermission({ mode: "read" })) === "granted";
}

/**
 * 上次工程句柄的持久化（IndexedDB）：句柄是可结构化克隆对象，IDB 原生支持存取；
 * 下次启动据此提供「重新打开上次工程」一键（免开选择器）。**任何 IDB 失败
 * （隐私模式 / 配额 / 不支持）一律静默**——功能退化为不存在，编辑器不受影响。
 * 保存入口 = `pickProjectDirectory` / 重开成功后由组合根调用（真实手势路径上）。
 */
export interface LastProjectHandleStore {
  load(): Promise<FileSystemDirectoryHandle | undefined>;
  save(handle: FileSystemDirectoryHandle): Promise<void>;
}

const LAST_PROJECT_DB = "lingfan-editor";
const LAST_PROJECT_STORE = "last-project";
const LAST_PROJECT_KEY = "last";

function isDirectoryHandleLike(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "directory"
  );
}

export function createLastProjectStore(
  idbFactory?: IDBFactory,
): LastProjectHandleStore {
  const factory =
    idbFactory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);

  function openDb(): Promise<IDBDatabase | undefined> {
    if (factory === undefined) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      try {
        const request = factory.open(LAST_PROJECT_DB, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(LAST_PROJECT_STORE)) {
            db.createObjectStore(LAST_PROJECT_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
        request.onblocked = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  return {
    async load() {
      const db = await openDb();
      if (db === undefined) return undefined;
      try {
        return await new Promise((resolve) => {
          try {
            const request = db
              .transaction(LAST_PROJECT_STORE, "readonly")
              .objectStore(LAST_PROJECT_STORE)
              .get(LAST_PROJECT_KEY);
            request.onsuccess = () => {
              const value = request.result as unknown;
              resolve(isDirectoryHandleLike(value) ? value : undefined);
            };
            request.onerror = () => resolve(undefined);
          } catch {
            resolve(undefined);
          }
        });
      } finally {
        db.close();
      }
    },
    async save(handle) {
      const db = await openDb();
      if (db === undefined) return;
      try {
        await new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(LAST_PROJECT_STORE, "readwrite");
            tx.objectStore(LAST_PROJECT_STORE).put(handle, LAST_PROJECT_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          } catch {
            resolve();
          }
        });
      } finally {
        db.close();
      }
    },
  };
}
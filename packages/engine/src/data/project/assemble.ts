import { isPlainObject } from "../../shared";
import { isOrientationMode, type DegradedOpen, type Story, type StoryColumn } from "../../contracts";
import { isSingleColumnFile, parseStory, parseStoryFile, StoryFormatError } from "../format";
import { ProjectAssemblyError } from "./error";
import { byPath, isDotPath, MANIFEST_FILE, STORIES_DIR } from "./naming";

/**
 * 工程组装：project.json + Stories/** → Story。
 * 文件内容由平台适配器供给（WebView 无 Node，I/O 归 Rust 与打包器）。
 * fail-closed：清单、文件、columnId 唯一、入口存在性任何不符 = 整次拒绝。
 */
/**
 * 为**缺清单**的资源根合成最小降级清单。
 *
 * 语义：真实工程可以没有 `project.json`（作者直接摆 Stories/）——「缺清单」
 * 只缺三件事：formatVersion（恒 1）、id（用资源根名兜底）、entry（**确定性**
 * 取路径码元序第一个列）。其余（defines / shell / extensions）缺省即正确语义。
 *
 * **只降级「缺清单」这一种**：故事文件解析失败照常跳过（与组装器同口径，
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
  // 工程级壳配置（作者声明的作品形态）：方向非法即拒绝（fail-closed）
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
    // **只处理 `Stories/` 下的文件**。
    //组装器**假定**调用方只喂故事文件，若喂了全量资源根就会炸：
    // `Lang/en-US/main.json`（译文表）等全被当故事解析
    // ⇒ 「formatVersion 必须为 1」让**整个工程组装失败**。
    // 判据：非 `Stories/` 一律跳过（它们由各自的视图/工具消费，不进故事列集）。
    if (!path.startsWith(`${STORIES_DIR}/`)) continue;
    // **占位文件不是故事**：`.gitkeep` 类空文件是版本控制的占位
    // （工程里常见 `Live2D/.gitkeep`、`Media/BGM/.gitkeep`），
    // 当成故事解析会因「文本中没有 label」让整个工程组装失败。
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
    // **文件名与列 id 解耦**。
    //
    // 「单列文件名（去扩展名）必须等于列 id」这条约束，动机是**防错位**：
    // 文件叫 A、内容是 B ⇒ AI/编辑器「按 id 定位文件」会找错。
    // 但真实工程用的是 `Stories/chapter1/chapter1.story` 装列 `chapter1_start`
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
      // **回填来源路径**：列从哪个文件来，就写回哪个文件。
      //
      // **只在「非默认路径」时显式写 `sourcePath`**：默认是 `Stories/<id>.json`，
      // 由 `columnFilePath` 隐式推导即可。显式写等于把「推导结果」存进状态，
      // 会让**新建列**（内存态无此字段）与**重开态**（有字段）不再深等 ——
      // 而「保存后重开一致」是最核心的不变量之一。
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

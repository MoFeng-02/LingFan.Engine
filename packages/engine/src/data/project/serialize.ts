import { isPlainObject } from "../../shared";
import { ProjectSerializationError } from "./error";
import { byPath, MANIFEST_FILE, STORIES_DIR, isSafeFileNameSegment } from "./naming";
import { columnShapeDefect } from "../format/column";
import type { SerializedProject, Story, StoryColumn } from "../../contracts";

/**
 * 工程写回：Story → 多文件工程（组装的逆过程）。
 * 字段序固定、托管键就地更新、非托管键原位保留；任何不符 = 整次拒绝。
 */
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
  // `type`（运行语义）**必须写回**：漏了会让 menu/ui 场景在下次打开时
  // 变成 game（保存 = 悄悄改语义，且**不可逆**——作者下次打开发现菜单能回溯了）。
  // 缺省 game 不写（保持文件干净），非缺省才写。
  if (column.type !== undefined && column.type !== "game") ordered.type = column.type;
  if (column.kind === "flow") {
    ordered.commands = column.commands ?? [];
  } else {
    ordered.elements = column.elements ?? [];
    if (column.entry !== undefined) ordered.entry = column.entry;
  }
  // `sourcePath` **刻意不写**（编辑期元数据：它描述「这个列来自哪个文件」，
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

/** 按路径码元序重排文件表，让写回/比对顺序不随 Map 插入顺序漂移（结果可复现） */
function sortByCodeUnit(files: Map<string, string>): Map<string, string> {
  return new Map([...files.entries()].sort((a, b) => byPath(a[0], b[0])));
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

    // type 的运行语义非法值同样 fail-closed：组装器是另一条入口（多文件工程），
    // 只在单文件解析层拦下会漏掉这条路（缺省 game 合法）。
    const shape = columnShapeDefect(column as unknown as Record<string, unknown>);
    if (shape !== null) {
      if (shape.reason === "bad-kind") {
        issues.push(
          `列 ${id} 的 kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(shape.received)}`,
        );
        continue;
      }
      if (shape.reason === "bad-type") {
        issues.push(
          `列 ${id} 的 type 必须为 "game" / "menu" / "ui"，收到 ${JSON.stringify(shape.received)}`,
        );
        continue;
      }
      if (shape.reason === "flow-without-commands") {
        issues.push(`列 ${id}（flow）必须有 commands 数组`);
      } else {
        issues.push(`列 ${id}（scene）必须有 elements 数组`);
      }
    }
  }
  if (typeof story.entry !== "string" || !seen.has(story.entry)) {
    issues.push(
      `入口列 ${JSON.stringify(story.entry)} 不存在于列集`,
    );
  }
  if (issues.length > 0) throw new ProjectSerializationError(issues);

  const files = new Map<string, string>();
  // **写回原路径**：凭 `id` 重算 `Stories/<id>.json` 的话，
  // 保存一次就会把作者的章节目录编排 + `.story` 文本形态**抹平**，原文件还会被判
  // 「陈旧」删除 —— 这会破坏作者的工程编排。
  //
  // **一个文件可承载多列**（常见形态：`chapter1.story` 装 `chapter1_start` /
  // `_explore` / `_forward` / `_end`）⇒ **按来源文件分组**写回，
  // 不是「一列一文件」。真冲突只有「**同一路径被声明两次且列集不同时**」——
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
 * **单列 ⇒ 保持单列原子形态**（`{formatVersion,id,kind,…}`，逐字节不变）；
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
 * 只认**安全相对路径**（`Stories/` 前缀 + 无 `..`）：`sourcePath` 来自
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
  const shape = columnShapeDefect(
    column as unknown as Record<string, unknown>,
    // 这一路只做 kind 与数组面校验，type 的非法值由文档解析层拦下。
    { checkType: false },
  );
  if (shape !== null) {
    if (shape.reason === "bad-kind") {
      issues.push(
        `列 ${column.id} 的 kind 必须为 "scene" 或 "flow"，收到 ${JSON.stringify(shape.received)}`,
      );
    } else if (shape.reason === "flow-without-commands") {
      issues.push(`列 ${column.id}（flow）必须有 commands 数组`);
    } else if (shape.reason === "scene-without-elements") {
      issues.push(`列 ${column.id}（scene）必须有 elements 数组`);
    }
  }

  if (issues.length > 0) throw new ProjectSerializationError(issues);

  // 单列写回**同样保留原路径**（与 `serializeProject` 同一路径规则）：
  // 固定 `Stories/<id>.json` ⇒ 编辑器保存一列就把它的章节目录拍平。
  const target = columnFilePath(column);
  return {
    files: new Map([[target, columnFileText(column)]]),
    written: new Map([[column.id, target]]),
  };
}

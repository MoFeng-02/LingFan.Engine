/**
 * 09-16 写回端到端：拟态用户旅程 + 混沌随机游走。
 *
 * 两层闭环：
 * 1. **纯函数闭环**（零 I/O）：`serializeProject(story, manifest)` → `assembleProject` 深等
 *    —— 这是写回正确性的根判据；
 * 2. **内存盘闭环**：写入 → 重建供给源 → 重开，与内存故事一致（FSA 句柄细节由
 *    `tests/adapters/resources/directorySource.test.ts` 覆盖，此处不重复平台双）。
 *
 * 列序语义（07 §三）：组装按**文件路径码元序**决定列序 → 写回后列序按列 id 固化，
 * 故比较基准是 `sortedStory(story)`（已排序的当前故事）。
 */
import { describe, expect, it } from "vitest";
import type { ProjectWriterPort, Story } from "@lingfan/engine";
import {
  assembleProject,
  diffProjectFiles,
  MANIFEST_FILE,
  ProjectSerializationError,
  serializeProject,
} from "@lingfan/engine";
import {
  createSourceProjectFilesPort,
  loadProject,
  type ProjectFileSource,
} from "@lingfan/adapters";
import {
  EditorSession,
  addColumn,
  insertAtPointer,
  removeAtPointer,
  removeColumn,
  renameColumn,
  setAtPointer,
} from "@lingfan/editor";

function colText(id: string, commands: unknown[] = []): string {
  return `${JSON.stringify({ formatVersion: 1, id, kind: "flow", commands }, null, 2)}\n`;
}

/** 列序 = 文件路径码元序（07 §三）：写回/重开后的比较基准 */
function sortedStory(story: Story): Story {
  return {
    ...story,
    columns: [...story.columns].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  };
}

function reAssemble(files: ReadonlyMap<string, string>): Story {
  let writtenManifest: unknown;
  const stories = new Map<string, string>();
  for (const [path, text] of files) {
    if (path === MANIFEST_FILE) writtenManifest = JSON.parse(text);
    else stories.set(path, text);
  }
  return assembleProject(writtenManifest, stories);
}

/** 内存工程盘：同一份 Map 既是供给源也是写回目标（闭环不碰 FSA API） */
function memoryDisk(initial: Record<string, string>): {
  files: Map<string, string>;
  source: ProjectFileSource;
  writer: ProjectWriterPort;
} {
  const files = new Map(Object.entries(initial));
  const source: ProjectFileSource = {
    name: "MemResources",
    async paths(): Promise<readonly string[]> {
      return [...files.keys()].sort();
    },
    async text(path: string): Promise<string> {
      const text = files.get(path);
      if (text === undefined) throw new Error(`资源不存在：${path}`);
      return text;
    },
    async file(path: string): Promise<File> {
      const text = files.get(path);
      if (text === undefined) throw new Error(`资源不存在：${path}`);
      return new File([text], path.split("/").pop() ?? path);
    },
  };
  const writer: ProjectWriterPort = {
    writable: true,
    async apply(wanted: ReadonlyMap<string, string>) {
      const { changes, deletes } = diffProjectFiles(wanted, files);
      for (const [path, text] of changes) files.set(path, text);
      for (const path of deletes) files.delete(path);
      return { written: [...changes.keys()], deleted: [...deletes] };
    },
  };
  return { files, source, writer };
}

async function openDisk(disk: {
  source: ProjectFileSource;
}): Promise<{ story: Story; manifest: unknown }> {
  const port = createSourceProjectFilesPort(disk.source);
  const manifest = await port.manifest();
  return { story: await loadProject(port), manifest };
}

const MANIFEST_TEXT = `${JSON.stringify(
  { formatVersion: 1, id: "demo", entry: "start", name: "演示" },
  null,
  2,
)}\n`;

function demoDisk(): ReturnType<typeof memoryDisk> {
  return memoryDisk({
    [MANIFEST_FILE]: MANIFEST_TEXT,
    "Stories/start.json": colText("start", [{ op: "jump", target: "inn" }]),
    "Stories/inn.json": colText("inn", [{ op: "say", text: "酒馆" }]),
  });
}

describe("09-16 写回·拟态用户旅程", () => {
  it("打开 → 改字段 / 重命名 / 新增 / 删除列 → 保存 → 重开一致", async () => {
    const disk = demoDisk();
    const { story, manifest } = await openDisk(disk);
    const session = new EditorSession(story);
    expect(session.dirty).toBe(false);
    // 列序 = 路径码元序：Stories/inn.json 在前
    expect(story.columns.map((c) => c.id)).toEqual(["inn", "start"]);

    expect(
      session.apply("改台词", (s) =>
        setAtPointer(s, "/columns/0/commands/0/text", "酒馆（改）"),
      ),
    ).toBe(true);
    expect(
      session.apply("重命名 inn → tavern", (s) =>
        renameColumn(s, "inn", "tavern"),
      ),
    ).toBe(true);
    session.apply("新增 finale", (s) => addColumn(s, { id: "finale" }).story);
    session.apply("新增 temp", (s) => addColumn(s, { id: "temp" }).story);
    session.apply("删除 temp", (s) => removeColumn(s, "temp"));
    expect(session.dirty).toBe(true);

    const target = session.story;
    const report = await disk.writer.apply(
      serializeProject(target, manifest).files,
    );
    session.markSaved(target);
    expect(session.dirty).toBe(false);

    expect(report.written).toContain("Stories/tavern.json");
    expect(report.written).toContain("Stories/finale.json");
    expect(report.written).not.toContain("Stories/temp.json");
    expect(report.deleted).toEqual(["Stories/inn.json"]);
    expect(disk.files.has("Stories/inn.json")).toBe(false);
    expect(disk.files.has("Stories/temp.json")).toBe(false);
    // 引用同步落盘：start 的 jump 目标已改成 tavern
    expect(disk.files.get("Stories/start.json")).toContain('"tavern"');

    // 重开一致（列序按文件路径码元序固化）；清单 name 保真
    const reopened = await openDisk(disk);
    expect(reopened.story).toEqual(sortedStory(target));
    expect(reopened.manifest).toMatchObject({ id: "demo", name: "演示" });

    // 再保存 → 零写零删（基线已推进）
    expect(
      await disk.writer.apply(serializeProject(target, manifest).files),
    ).toEqual({ written: [], deleted: [] });
  });

  it("打开 → 撤销回已保存态 → 干净（无需保存）", async () => {
    const disk = demoDisk();
    const { story, manifest } = await openDisk(disk);
    const session = new EditorSession(story);
    session.apply("改", (s) => setAtPointer(s, "/columns/0/commands/0/text", "X"));
    expect(session.dirty).toBe(true);
    session.undo();
    expect(session.dirty).toBe(false);
    // 无改动 → 期望集与基线逐字节相同（additive: 清单语义比较也不触发）
    const diff = diffProjectFiles(
      serializeProject(session.story, manifest).files,
      serializeProject(story, manifest).files,
    );
    expect(diff.changes.size).toBe(0);
    expect(diff.deletes).toEqual([]);
  });
});

describe("09-16 写回·混沌随机游走（种子化 300 步）", () => {
  it("每步纯函数闭环不变量；每 25 步真实写回 + 重开一致", async () => {
    const disk = demoDisk();
    const { story, manifest } = await openDisk(disk);
    const session = new EditorSession(story);

    let seed = 20260927;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const int = (n: number): number => Math.floor(rand() * n);
    const ID_POOL = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"];
    const unusedId = (s: Story): string => {
      const free = ID_POOL.filter((id) => !s.columns.some((c) => c.id === id));
      return free.length === 0 ? `auto-${int(1e6)}` : (free[int(free.length)] ?? "auto");
    };
    const flowIndexes = (s: Story): number[] =>
      s.columns
        .map((c, i) => (c.kind === "flow" ? i : -1))
        .filter((i) => i >= 0);
    const editableIndexes = (s: Story): number[] =>
      s.columns.map((c, i) => (c.id === s.entry ? -1 : i)).filter((i) => i >= 0);

    let saves = 0;

    for (let step = 0; step < 300; step += 1) {
      const op = int(6);
      session.apply(`step-${step}`, (s) => {
        const flows = flowIndexes(s);
        const editable = editableIndexes(s);
        switch (op) {
          case 0: {
            const i = flows[int(flows.length)];
            if (i === undefined) return null;
            const list = s.columns[i]?.commands ?? [];
            return insertAtPointer(s, `/columns/${i}/commands`, int(list.length + 1), {
              op: "say",
              text: `t${step}`,
            });
          }
          case 1: {
            const i = flows[int(flows.length)];
            if (i === undefined) return null;
            const list = s.columns[i]?.commands ?? [];
            if (list.length === 0) return null;
            return removeAtPointer(s, `/columns/${i}/commands/${int(list.length)}`);
          }
          case 2: {
            const i = flows[int(flows.length)];
            if (i === undefined) return null;
            const list = s.columns[i]?.commands ?? [];
            if (list.length === 0) return null;
            return setAtPointer(
              s,
              `/columns/${i}/commands/${int(list.length)}/text`,
              `改 ${step}`,
            );
          }
          case 3:
            return addColumn(s, { id: unusedId(s) }).story;
          case 4: {
            const i = editable[int(editable.length)];
            const column = i === undefined ? undefined : s.columns[i];
            if (column === undefined) return null;
            return removeColumn(s, column.id);
          }
          default: {
            const i = editable[int(editable.length)];
            const column = i === undefined ? undefined : s.columns[i];
            if (column === undefined) return null;
            return renameColumn(s, column.id, unusedId(s));
          }
        }
      });

      // 不变量 1：纯函数闭环（非法态必须抛 ProjectSerializationError，不产坏文件）
      let files: Map<string, string> | null = null;
      try {
        files = serializeProject(session.story, manifest).files;
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProjectSerializationError);
      }
      if (files !== null) {
        expect(reAssemble(files)).toEqual(sortedStory(session.story));
      }

      // 不变量 2：每 25 步真实写回 → 重开一致
      if (files !== null && step % 25 === 0) {
        await disk.writer.apply(files);
        const reopened = await openDisk(disk);
        expect(reopened.story).toEqual(sortedStory(session.story));
        saves += 1;
      }
    }

    expect(saves).toBeGreaterThan(5);
    // 收尾：公开方法零抛异常 + 列集非空即仍可序列化
    expect(() => session.story.columns.map((c) => c.id)).not.toThrow();
    if (session.story.columns.length > 0) {
      expect(() => serializeProject(session.story, manifest)).not.toThrow();
    }
  });
});
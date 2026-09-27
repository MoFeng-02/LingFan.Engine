/** 07 §三 工程组装测试：混合形态、确定性、F1 跨文件唯一、入口校验、defines 覆盖序 */
import { describe, expect, it } from "vitest";
import type { Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import {
  assembleProject,
  diffProjectFiles,
  isSafeFileNameSegment,
  MANIFEST_FILE,
  ProjectAssemblyError,
  ProjectSerializationError,
  serializeProject,
  StoryEngine,
} from "@lingfan/engine";

const manifest = { formatVersion: 1, id: "demo", entry: "start" };

const singleColumn = (id: string): unknown => ({
  formatVersion: 1,
  id,
  kind: "flow",
  commands: [{ op: "say", text: `${id} 的台词` }],
});

const issuesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectAssemblyError) return e.issues;
    throw e;
  }
  throw new Error("应当抛出 ProjectAssemblyError");
};

describe("assembleProject", () => {
  it("混合形态组装：单列文件 + 多列文件，路径码元序决定列序", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", singleColumn("start")],
      [
        "Stories/ch1.json",
        {
          formatVersion: 1,
          columns: [{ id: "prologue", kind: "flow", commands: [] }],
        },
      ],
    ]);
    const story = assembleProject(manifest, files);
    expect(story.columns.map((c) => c.id)).toEqual(["prologue", "start"]);
    expect(story.entry).toBe("start");
    expect(story.id).toBe("demo");
  });

  it("确定性：文件插入顺序不影响组装结果", () => {
    const entryA = { ...manifest, entry: "a" };
    const a = new Map<string, unknown>([
      ["Stories/b.json", singleColumn("b")],
      ["Stories/a.json", singleColumn("a")],
    ]);
    const b = new Map<string, unknown>([
      ["Stories/a.json", singleColumn("a")],
      ["Stories/b.json", singleColumn("b")],
    ]);
    expect(assembleProject(entryA, a).columns.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
    expect(assembleProject(entryA, b).columns.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("F1：跨文件 columnId 重复拒绝，错误带两个文件定位", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", singleColumn("start")],
      [
        "Stories/other.json",
        {
          formatVersion: 1,
          columns: [{ id: "start", kind: "flow", commands: [] }],
        },
      ],
    ]);
    const issues = issuesOf(() => assembleProject(manifest, files));
    expect(issues.join("\n")).toContain("columnId 重复");
    expect(issues.join("\n")).toContain("other.json");
    expect(issues.join("\n")).toContain("start.json");
  });

  it("单列文件名必须等于列 id（AI/编辑器按 id 定位文件的不变量）", () => {
    const files = new Map<string, unknown>([
      ["Stories/wrong.json", singleColumn("start")],
    ]);
    const issues = issuesOf(() => assembleProject(manifest, files));
    expect(issues.join("\n")).toContain("单列文件名");
  });

  it("defines 合并：工程默认最先，文件按序覆盖（后加载覆盖，01 §一.6）", () => {
    const files = new Map<string, unknown>([
      [
        "Stories/a.json",
        {
          formatVersion: 1,
          id: "a",
          kind: "flow",
          commands: [],
          defines: { "player.gold": 99, "file.only": "a" },
        },
      ],
    ]);
    const story = assembleProject(
      {
        ...manifest,
        entry: "a",
        defines: { "player.gold": 1, "proj.only": true },
      },
      files,
    );
    expect(story.defines).toEqual({
      "player.gold": 99,
      "proj.only": true,
      "file.only": "a",
    });
  });

  it("入口列不存在拒绝（01 §一.7 + F1）", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", singleColumn("start")],
    ]);
    const issues = issuesOf(() =>
      assembleProject({ ...manifest, entry: "nope" }, files),
    );
    expect(issues.join("\n")).toContain("入口列");
  });

  it("清单非法（缺 entry / 坏 defines）拒绝", () => {
    expect(
      issuesOf(() =>
        assembleProject({ formatVersion: 1, id: "x" }, new Map()),
      ).join("\n"),
    ).toContain("entry");
    expect(
      issuesOf(() =>
        assembleProject({ ...manifest, defines: "bad" }, new Map()),
      ).join("\n"),
    ).toContain("defines");
  });

  it("08 §八.2 清单 shell 段：合法方向接受，非法形状/非法方向整次拒绝（fail-closed）", () => {
    const files = new Map([["Stories/start.json", singleColumn("start")]]);
    // 锚点: orientation-config-resolution——作者声明的作品形态随组装通过
    for (const orientation of ["auto", "portrait", "landscape"]) {
      const story = assembleProject(
        { ...manifest, shell: { orientation } },
        new Map([["Stories/start.json", singleColumn("start")]]),
      );
      expect(story.entry).toBe("start");
    }
    for (const bad of [
      { shell: "landscape" },
      { shell: { orientation: "diagonal" } },
      { shell: { orientation: 90 } },
    ]) {
      expect(issuesOf(() => assembleProject({ ...manifest, ...bad }, files)).join("\n")).toMatch(
        /shell/,
      );
    }
  });

  it("坏文件整批拒绝且带文件定位", () => {
    const files = new Map<string, unknown>([
      ["Stories/bad.json", { formatVersion: 2 }],
    ]);
    const issues = issuesOf(() => assembleProject(manifest, files));
    expect(issues.join("\n")).toContain("bad.json");
    expect(issues.join("\n")).toContain("formatVersion");
  });

  it("组装结果可直接驱动引擎（冒烟）", () => {
    const story = assembleProject(
      manifest,
      new Map([["Stories/start.json", singleColumn("start")]]),
    );
    const engine = new StoryEngine(story);
    engine.start();
    expect(engine.get("__current_dialog_text")).toBe("start 的台词");
  });
});

// —— 09-16 写回：serializeProject / diffProjectFiles ——

/** 单列 flow 文件原始文本 */
function flowJson(id: string, commands: unknown[] = []): string {
  return JSON.stringify({ formatVersion: 1, id, kind: "flow", commands });
}

function sceneJson(id: string, elements: unknown[], entry?: unknown[]): string {
  return JSON.stringify({
    formatVersion: 1,
    id,
    kind: "scene",
    elements,
    ...(entry === undefined ? {} : { entry }),
  });
}

/** 从原始文本装载（真实路径：组装器是唯一解析点） */
function load(manifest: unknown, stories: Record<string, string>): Story {
  return assembleProject(manifest, new Map(Object.entries(stories)));
}

/** 把序列化产物（清单 + 列文件）再组装回去——往返互锁的判据 */
function reAssemble(files: ReadonlyMap<string, string>): Story {
  let writtenManifest: unknown;
  const stories = new Map<string, string>();
  for (const [path, text] of files) {
    if (path === MANIFEST_FILE) writtenManifest = JSON.parse(text);
    else stories.set(path, text);
  }
  return assembleProject(writtenManifest, stories);
}

const serializationIssues = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ProjectSerializationError) return e.issues;
    throw e;
  }
  throw new Error("应当抛出 ProjectSerializationError");
};

const column = (id: string, commands: StoryCommand[] = []): StoryColumn => ({
  id,
  kind: "flow",
  commands,
});

const storyOf = (columns: StoryColumn[], entry?: string): Story => ({
  formatVersion: 1,
  id: "demo",
  entry: entry ?? columns[0]?.id ?? "",
  columns,
});

describe("serializeProject（写回往返互锁）", () => {
  it("单列 flow：文件集 = 每列一个 + 清单（码元序），往返深等", () => {
    const story = load(manifest, {
      "Stories/start.json": flowJson("start", [{ op: "say", text: "甲" }]),
    });
    const { files } = serializeProject(story, manifest);
    expect([...files.keys()]).toEqual([
      "Stories/start.json",
      MANIFEST_FILE,
    ]);
    expect(files.get("Stories/start.json")).toBe(
      '{\n  "formatVersion": 1,\n  "id": "start",\n  "kind": "flow",\n  "commands": [\n    {\n      "op": "say",\n      "text": "甲"\n    }\n  ]\n}\n',
    );
    expect(reAssemble(files)).toEqual(story);
  });

  it("多列文件规范化：拆成单列文件，原文件列入删除集，往返深等", () => {
    const entry = { formatVersion: 1, id: "demo", entry: "a" };
    const story = load(entry, {
      "Stories/ch1.json": JSON.stringify({
        formatVersion: 1,
        columns: [
          { id: "a", kind: "flow", commands: [] },
          { id: "b", kind: "flow", commands: [{ op: "say", text: "b" }] },
        ],
      }),
    });
    const { files } = serializeProject(story, entry);
    expect([...files.keys()]).toEqual([
      "Stories/a.json",
      "Stories/b.json",
      MANIFEST_FILE,
    ]);
    const baseline = new Map([["Stories/ch1.json", "旧内容"]]);
    expect(diffProjectFiles(files, baseline).deletes).toEqual([
      "Stories/ch1.json",
    ]);
    expect(reAssemble(files)).toEqual(story);
  });

  it("scene 列元素：elements 保序、entry 有值才写、往返深等", () => {
    const entry = { formatVersion: 1, id: "demo", entry: "stage" };
    const story = load(entry, {
      "Stories/stage.json": sceneJson(
        "stage",
        [{ type: "panel", id: "p1" }],
        [{ op: "say", text: "入口命令" }],
      ),
    });
    const { files } = serializeProject(story, entry);
    const text = files.get("Stories/stage.json") ?? "";
    expect(text).toContain('"kind": "scene"');
    expect(text.indexOf('"elements"')).toBeLessThan(text.indexOf('"entry"'));
    expect(reAssemble(files)).toEqual(story);

    const noEntry = serializeProject(
      storyOf([{ id: "s2", kind: "scene", elements: [] }], "s2"),
      entry,
    );
    expect(noEntry.files.get("Stories/s2.json")).not.toContain('"entry"');
  });

  it("defines 上移清单级：合并结果写清单、列文件不写 defines，往返代替价等价（互锁）", () => {
    const entry = {
      formatVersion: 1,
      id: "demo",
      entry: "a",
      defines: { "player.gold": 1, "proj.only": true },
    };
    const story = load(entry, {
      "Stories/a.json": JSON.stringify({
        formatVersion: 1,
        id: "a",
        kind: "flow",
        commands: [],
        defines: { "player.gold": 99, "file.only": "a" },
      }),
    });
    expect(story.defines).toEqual({
      "player.gold": 99,
      "proj.only": true,
      "file.only": "a",
    });
    const { files } = serializeProject(story, entry);
    const written = JSON.parse(files.get(MANIFEST_FILE) ?? "") as {
      defines: Record<string, unknown>;
    };
    expect(written.defines).toEqual(story.defines);
    expect(files.get("Stories/a.json")).not.toContain("defines");
    expect(reAssemble(files).defines).toEqual(story.defines);
    expect(reAssemble(files)).toEqual(story);
  });

  it("清单保真：name/lang/shell/resourceEncryption/未知扩展键原值保留，托管键就地更新", () => {
    const entry = {
      formatVersion: 1,
      id: "demo",
      entry: "start",
      name: "灵泛演示",
      lang: "zh-CN",
      resourceEncryption: true,
      shell: { orientation: "landscape" },
      "x-future": { anything: [1, 2, 3] },
    };
    const story = load(entry, {
      "Stories/start.json": flowJson("start"),
    });
    const next: Story = { ...story, id: "renamed", entry: "start" };
    const written = JSON.parse(
      serializeProject(next, entry).files.get(MANIFEST_FILE) ?? "",
    ) as Record<string, unknown>;
    expect(written).toEqual({
      formatVersion: 1,
      id: "renamed",
      entry: "start",
      name: "灵泛演示",
      lang: "zh-CN",
      resourceEncryption: true,
      shell: { orientation: "landscape" },
      "x-future": { anything: [1, 2, 3] },
    });
  });

  it("确定性：同一输入两次序列化逐字节相同", () => {
    const entry = { ...manifest, entry: "a" };
    const story = load(entry, {
      "Stories/b.json": flowJson("b"),
      "Stories/a.json": flowJson("a"),
    });
    const first = serializeProject(story, entry).files;
    const second = serializeProject(story, entry).files;
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("空 defines 省略该键（不写空对象）", () => {
    const story = storyOf([column("start")]);
    const written = JSON.parse(
      serializeProject(story, manifest).files.get(MANIFEST_FILE) ?? "",
    ) as Record<string, unknown>;
    expect("defines" in written).toBe(false);
  });
});

describe("diffProjectFiles（最小差量）", () => {
  const entry = {
    formatVersion: 1,
    id: "demo",
    entry: "start",
    name: "手写排版",
  };

  it("无改动 → changes/deletes 空；JSON 语义相等（手写排版）一律跳过", () => {
    const story = load(entry, { "Stories/start.json": flowJson("start") });
    const { files } = serializeProject(story, entry);
    const column = JSON.parse(files.get("Stories/start.json") ?? "") as unknown;
    const baseline = new Map<string, string>([
      [MANIFEST_FILE, JSON.stringify(entry, null, 4)], // 排版不同、语义相同
      // 故事文件同样手写排版（单行内联）——语义相等即跳过，不重排版作者文件
      ["Stories/start.json", JSON.stringify(column)],
    ]);
    const diff = diffProjectFiles(files, baseline);
    expect(diff.changes.size).toBe(0);
    expect(diff.deletes).toEqual([]);
  });

  it("非 JSON（.story 文本形态）退化为逐字节比较 → 规范化为 JSON 写入", () => {
    const story = load(entry, { "Stories/start.json": flowJson("start") });
    const files = serializeProject(story, entry).files;
    const baseline = new Map(files);
    baseline.set("Stories/start.json", 'start:\n  say "文本形态"');
    const diff = diffProjectFiles(files, baseline);
    expect([...diff.changes.keys()]).toEqual(["Stories/start.json"]);
  });

  it("仅改一列 → 只写该列；清单语义未变不写", () => {
    const story = load(entry, {
      "Stories/start.json": flowJson("start", [{ op: "say", text: "甲" }]),
    });
    const baseline = serializeProject(story, entry).files;
    const changed: Story = {
      ...story,
      columns: story.columns.map((c) => ({
        ...c,
        commands: [{ op: "say", text: "乙" }],
      })),
    };
    const diff = diffProjectFiles(
      serializeProject(changed, entry).files,
      baseline,
    );
    expect([...diff.changes.keys()]).toEqual(["Stories/start.json"]);
    expect(diff.deletes).toEqual([]);
  });

  it("新增列 → 新文件进 changes；无基线 → 全量写、零删", () => {
    const story = load(entry, { "Stories/start.json": flowJson("start") });
    const withNew: Story = {
      ...story,
      columns: [...story.columns, column("side", [{ op: "say", text: "支线" }])],
    };
    const files = serializeProject(withNew, entry).files;
    const diff = diffProjectFiles(files, serializeProject(story, entry).files);
    expect([...diff.changes.keys()]).toEqual(["Stories/side.json"]);
    const fresh = diffProjectFiles(files, new Map());
    expect([...fresh.changes.keys()]).toEqual([...files.keys()]);
    expect(fresh.deletes).toEqual([]);
  });

  it("删除列 → 旧文件进 deletes；非 Stories/ 路径永不可删", () => {
    const story = load(entry, {
      "Stories/start.json": flowJson("start"),
      "Stories/side.json": flowJson("side"),
    });
    const trimmed: Story = {
      ...story,
      columns: story.columns.filter((c) => c.id === "start"),
    };
    const baseline = new Map(serializeProject(story, entry).files);
    baseline.set("Audio/x.mp3", "音频不该被删");
    const diff = diffProjectFiles(serializeProject(trimmed, entry).files, baseline);
    expect(diff.deletes).toEqual(["Stories/side.json"]);
  });
});

describe("serializeProject（fail-closed 对抗输入）", () => {
  it("列 id 不能作文件名安全使用：全表拒绝", () => {
    const bad = [
      ".",
      "..",
      ".hidden",
      "a/b",
      "a\\b",
      "a:b",
      "a*b",
      "a?b",
      'a"b',
      "a<b",
      "a>b",
      "a|b",
      "trailing.",
      "trailing ",
      "ctrl\u0001name",
      "x".repeat(201),
    ];
    for (const id of bad) {
      expect(isSafeFileNameSegment(id)).toBe(false);
      const issues = serializationIssues(() =>
        serializeProject(storyOf([column(id)]), manifest),
      );
      expect(issues.join("\n")).toContain("文件名");
    }
    // 空 id 走「非空字符串」门（更精确的定位，同样拒绝）
    expect(isSafeFileNameSegment("")).toBe(false);
    expect(
      serializationIssues(() =>
        serializeProject(storyOf([column("")]), manifest),
      ).join("\n"),
    ).toContain("非空字符串");
    expect(isSafeFileNameSegment("start")).toBe(true);
    expect(isSafeFileNameSegment("chapter-1_开场")).toBe(true);
  });

  it("大小写不敏感碰撞拒绝（Windows/APFS 上同一文件）", () => {
    const issues = serializationIssues(() =>
      serializeProject(storyOf([column("Start"), column("start")]), manifest),
    );
    expect(issues.join("\n")).toContain("大小写不敏感碰撞");
  });

  it("重复 columnId / 入口列缺失 / 空列集 / 清单非对象 全部拒绝", () => {
    expect(
      serializationIssues(() =>
        serializeProject(storyOf([column("a"), column("a")]), manifest),
      ).join("\n"),
    ).toContain("columnId 重复");
    expect(
      serializationIssues(() =>
        serializeProject(storyOf([column("a")], "ghost"), manifest),
      ).join("\n"),
    ).toContain("入口列");
    expect(
      serializationIssues(() => serializeProject(storyOf([]), manifest)).join(
        "\n",
      ),
    ).toContain("至少需要一列");
    for (const bad of [null, [], "x", 42]) {
      expect(() => serializeProject(storyOf([column("a")]), bad)).toThrow(
        ProjectSerializationError,
      );
    }
  });

  it("列形态非法拒绝：kind 非枚举 / flow 缺 commands / scene 缺 elements", () => {
    expect(
      serializationIssues(() =>
        serializeProject(
          { ...storyOf([column("a")]), columns: [{ id: "a", kind: "flow" }] },
          manifest,
        ),
      ).join("\n"),
    ).toContain("commands");
    expect(
      serializationIssues(() =>
        serializeProject(
          storyOf([{ id: "s", kind: "scene", elements: undefined }], "s"),
          manifest,
        ),
      ).join("\n"),
    ).toContain("elements");
    expect(
      serializationIssues(() =>
        serializeProject(
          storyOf([
            { id: "x", kind: "weird" as unknown as "flow", commands: [] },
          ]),
          manifest,
        ),
      ).join("\n"),
    ).toContain("kind");
  });
});

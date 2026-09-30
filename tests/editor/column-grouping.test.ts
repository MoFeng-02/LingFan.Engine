/**
 * 列分组归类（UI 侧元数据）测试。
 *
 * 测试纪律五类：
 * - 拟态作者旅程：建组 → 归类 → 折叠 → **重开仍在**（「分组后重开后分组仍在」）
 * - 互锁：分组不改故事（`serializeProject` 逐字节 + `diffProjectFiles` 零 changes/deletes）；
 *   元数据不出现在故事 JSON / 写回文件里
 * - 故意错误：坏 JSON / 版本不符 / 畸形条目 / 恶性存储 → 降级空视图，零抛
 * - 边界：删列裁剪 / 改名同步 / 空组保留 / 未知分组 fail-closed / id 避撞 / 跨组移动
 * - 混沌游走：种子化 200 步混合（分组面 + 故事面），每步断言不变量
 */

import { describe, expect, it } from "vitest";
import type { Story, StoryColumn, StoryCommand } from "@lingfan/engine";
import { diffProjectFiles, serializeProject } from "@lingfan/engine";
import {
  COLUMN_GROUPING_KEY_PREFIX,
  EditorSession,
  addColumn,
  addGroup,
  assignColumn,
  createColumnGroupingStore,
  emptyGroupingView,
  layoutColumns,
  parseGroupingView,
  pruneGroupingView,
  removeColumn,
  removeGroup,
  renameColumn,
  renameColumnMember,
  renameGroup,
  serializeGroupingView,
  toggleCollapsed,
  type ColumnGroupingView,
  type KeyValueStorage,
} from "@lingfan/editor";
import appSource from "../../apps/editor/src/App.vue?raw";
import columnListSource from "../../apps/editor/src/components/ColumnList.vue?raw";

const manifest = { formatVersion: 1, id: "demo", entry: "start" };

/** 内存 Storage 契约替身（与 webStoragePreferences.test.ts 同款形态） */
class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function flowColumn(id: string, commands: StoryCommand[]): StoryColumn {
  return { id, kind: "flow", commands };
}

/** 四列示例：三流程列 + 一场景列（含入口列 start） */
function makeStory(): Story {
  return {
    formatVersion: 1,
    id: "demo",
    entry: "start",
    columns: [
      flowColumn("start", [{ op: "say", text: "开场" }]),
      flowColumn("tavern", [{ op: "say", text: "酒馆" }]),
      flowColumn("square", []),
      { id: "stage", kind: "scene", elements: [] },
    ],
  };
}

function idsOf(story: Story): string[] {
  return story.columns.map((column) => column.id);
}

/** 划分不变量：布局是 `columnIds` 的**恰好划分**（无未知 id、无重复归属、无遗漏） */
function expectExactPartition(
  view: ColumnGroupingView,
  columnIds: readonly string[],
): void {
  const plan = layoutColumns(view, columnIds);
  const laidOut = [
    ...plan.groups.flatMap((group) => group.columns),
    ...plan.ungrouped,
  ];
  expect(laidOut.slice().sort()).toEqual([...columnIds].slice().sort());
  expect(new Set(laidOut).size).toBe(laidOut.length);
}

/** 种子化 PRNG（混沌游走用，确定性） */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("拟态作者旅程", () => {
  it("建组 → 归类 → 折叠 → 重开后分组与折叠仍在", () => {
    const storage = new MemoryStorage();
    const store = createColumnGroupingStore(storage);

    let view = addGroup(emptyGroupingView(), "序章");
    const groupId = view.groups[0]?.id ?? "";
    expect(groupId).toBe("group-1");
    view = assignColumn(view, "start", groupId);
    view = assignColumn(view, "tavern", groupId);
    view = toggleCollapsed(view, groupId);
    store.save("demo", view);

    // 「重开编辑器」= 同 storage 上的新 store 实例
    const reopened = createColumnGroupingStore(storage).load("demo");
    expect(reopened.groups.map((group) => group.id)).toEqual([groupId]);
    expect(reopened.groups[0]?.name).toBe("序章");
    expect(reopened.groups[0]?.columns).toEqual(["start", "tavern"]);
    expect(reopened.collapsed).toEqual([groupId]);

    const plan = layoutColumns(reopened, ["start", "tavern", "square", "stage"]);
    expect(plan.groups[0]?.columns).toEqual(["start", "tavern"]);
    expect(plan.groups[0]?.collapsed).toBe(true);
    expect(plan.ungrouped).toEqual(["square", "stage"]);
  });

  it("组内展示序恒随列序（而非归类先后）：列序 = 文件路径码元序，分组不得改写它", () => {
    // 先归 stage 再归 start，但展示序必须回到 columnIds 的码元序
    let view = assignColumn(
      addGroup(emptyGroupingView(), "序章"),
      "stage",
      "group-1",
    );
    view = assignColumn(view, "start", "group-1");
    const plan = layoutColumns(view, ["start", "square", "stage"]);
    expect(plan.groups[0]?.columns).toEqual(["start", "stage"]);
  });

  it("无分组时布局与平铺等价（不用分组的作者零视觉变化）", () => {
    const plan = layoutColumns(emptyGroupingView(), ["start", "tavern"]);
    expect(plan.groups).toEqual([]);
    expect(plan.ungrouped).toEqual(["start", "tavern"]);
  });
});

describe("互锁：分组不改故事、元数据不出故事面", () => {
  it("不变量①：全套分组操作前后 serializeProject 逐字节一致、零 changes/零 deletes", () => {
    const story = makeStory();
    const before = serializeProject(story, manifest).files;

    let view = addGroup(emptyGroupingView(), "序章");
    view = addGroup(view, "第二章");
    view = assignColumn(view, "start", "group-1");
    view = assignColumn(view, "tavern", "group-2");
    view = toggleCollapsed(view, "group-1");
    view = renameGroup(view, "group-1", "第一章");
    view = removeGroup(view, "group-2");
    view = renameColumnMember(view, "start", "start2");
    view = pruneGroupingView(view, idsOf(story));
    expect(view.groups.length).toBe(1); // 操作确实生效（对照组，防「空跑」假绿）

    const after = serializeProject(story, manifest).files;
    expect([...after.entries()]).toEqual([...before.entries()]);
    const diff = diffProjectFiles(after, before);
    expect(diff.changes.size).toBe(0);
    expect(diff.deletes).toEqual([]);
  });

  it("不变量②：分组元数据不出现在故事 JSON / 写回文件里", () => {
    const story = makeStory();
    const files = serializeProject(story, manifest).files;
    const surface = [...files.values()].join("\n") + JSON.stringify(story);
    expect(surface).not.toContain("colgroups");
    expect(surface).not.toContain(COLUMN_GROUPING_KEY_PREFIX);
    expect(surface).not.toMatch(/"groups"\s*:/);
    expect(surface).not.toMatch(/"collapsed"\s*:/);
  });

  it("不变量③：分组操作不产生 undo 单元、不动 dirty、不改故事引用", () => {
    const story = makeStory();
    const session = new EditorSession(story);
    let view = addGroup(emptyGroupingView(), "序章");
    view = assignColumn(view, "start", "group-1");
    view = toggleCollapsed(view, "group-1");
    view = removeGroup(view, "group-1");
    expect(view.groups).toEqual([]); // 对照：操作确实生效（防「空跑」假绿）
    // 结构性保证：纯函数只收 columnIds，拿不到 Story ⇒ 会话与故事引用必然不动
    expect(session.story).toBe(story);
    expect(session.dirty).toBe(false);
    expect(session.undoDepth).toBe(0);
  });

  it("store 按 story.id 归位：不同故事的分组互不串门", () => {
    const storage = new MemoryStorage();
    const store = createColumnGroupingStore(storage);
    store.save("demo", assignColumn(addGroup(emptyGroupingView(), "A"), "start", "group-1"));
    expect(store.load("other").groups).toEqual([]);
    expect(store.load("demo").groups.length).toBe(1);
    expect(storage.map.has(`${COLUMN_GROUPING_KEY_PREFIX}demo`)).toBe(true);
  });
});

describe("故意错误：坏存储一律降级，零抛", () => {
  const broken: unknown[] = [
    null,
    undefined,
    42,
    true,
    "not json",
    "{",
    "[]",
    "{}",
    { version: 9, groups: [] },
    { version: 1 },
    { version: 1, groups: "nope" },
    { version: 1, groups: [null, 7, [], "x"] },
    { version: 1, groups: [{ id: "", name: "空 id", columns: ["start"] }] },
    {
      version: 1,
      groups: [{ id: "g", name: 5, columns: [1, null, "start", "start"] }],
    },
    { version: 1, groups: [{ id: "g", name: "组" }], collapsed: ["g", "ghost", 9] },
  ];

  it("逐项解析不抛；顶层形状/版本不符 → 空视图", () => {
    for (const raw of broken) {
      expect(() => parseGroupingView(raw), JSON.stringify(raw)).not.toThrow();
    }
    expect(parseGroupingView("not json")).toEqual(emptyGroupingView());
    expect(parseGroupingView("{")).toEqual(emptyGroupingView());
    expect(parseGroupingView([])).toEqual(emptyGroupingView());
    expect(parseGroupingView({ version: 9, groups: [] })).toEqual(
      emptyGroupingView(),
    );
    expect(parseGroupingView({ version: 1 })).toEqual(emptyGroupingView());
    expect(parseGroupingView(null)).toEqual(emptyGroupingView());
  });

  it("逐条目坏项跳过（不因一个坏组丢整份缓存）", () => {
    const view = parseGroupingView({
      version: 1,
      groups: [
        { id: "g1", name: "好组", columns: ["start", "start", 5, null] },
        { id: "g1", name: "重复 id", columns: ["tavern"] },
        { id: "", name: "空 id", columns: [] },
        { id: "g2", name: 5, columns: ["tavern"] },
      ],
      collapsed: ["g1", "ghost", 9],
    });
    expect(view.groups.map((group) => group.id)).toEqual(["g1", "g2"]);
    expect(view.groups[0]?.name).toBe("好组");
    expect(view.groups[0]?.columns).toEqual(["start"]); // 组内去重 + 非字符串丢弃
    expect(view.groups[1]?.name).toBe("g2"); // 名字非字符串 → 回退 id
    expect(view.groups[1]?.columns).toEqual(["tavern"]);
    expect(view.collapsed).toEqual(["g1"]); // 悬空折叠项丢弃
  });

  it("恶性存储（getItem/setItem 抛）与未注入存储都不影响可用性", () => {
    const hostile: KeyValueStorage = {
      getItem(): string | null {
        throw new Error("blocked");
      },
      setItem(): void {
        throw new Error("quota exceeded");
      },
    };
    const hostileStore = createColumnGroupingStore(hostile);
    expect(hostileStore.load("demo")).toEqual(emptyGroupingView());
    expect(() =>
      hostileStore.save("demo", emptyGroupingView()),
    ).not.toThrow();

    const noStore = createColumnGroupingStore(undefined);
    expect(noStore.load("demo")).toEqual(emptyGroupingView());
    expect(() => noStore.save("demo", emptyGroupingView())).not.toThrow();
  });
});

describe("边界：裁剪 / 改名 / 空组 / 未知分组 fail-closed / id 避撞", () => {
  it("删列后悬空成员被裁剪；**空组保留**；无悬空时原引用返回", () => {
    const view = assignColumn(
      addGroup(emptyGroupingView(), "序章"),
      "start",
      "group-1",
    );
    const pruned = pruneGroupingView(view, ["tavern"]); // start 已不存在
    expect(pruned.groups[0]?.columns).toEqual([]);
    expect(pruned.groups.length).toBe(1); // 空组不删
    // 无悬空 = 无变化（原引用，宿主据此跳过落盘）
    expect(pruneGroupingView(pruned, ["tavern"])).toBe(pruned);
  });

  it("列改名同步成员 id；重名冲突时首次归属优先", () => {
    let view = assignColumn(
      addGroup(emptyGroupingView(), "序章"),
      "start",
      "group-1",
    );
    view = assignColumn(view, "tavern", "group-1");
    const renamed = renameColumnMember(view, "start", "tavern"); // 撞名
    expect(renamed.groups[0]?.columns).toEqual(["tavern"]); // 去重后只剩一个
    expect(renameColumnMember(view, "absent", "x")).toBe(view); // 未命中 → 原引用
    expect(renameColumnMember(view, "start", "start")).toBe(view); // 同名 → 原引用
  });

  it("空 columnIds：无未归类项，分组与成员集合仍在（渲染侧按列存在性兜底）", () => {
    const view = assignColumn(
      addGroup(emptyGroupingView(), "序章"),
      "start",
      "group-1",
    );
    const plan = layoutColumns(view, []);
    expect(plan.ungrouped).toEqual([]);
    expect(plan.groups.length).toBe(1);
    expect(plan.groups[0]?.columns).toEqual([]);
  });

  it("未知分组 id / 未知列：fail-closed（原引用返回，不静默改动）", () => {
    let view = addGroup(emptyGroupingView(), "序章");
    view = assignColumn(view, "start", "group-1");
    const untouched: ColumnGroupingView = view;
    expect(assignColumn(untouched, "start", "group-404")).toBe(untouched);
    expect(renameGroup(untouched, "group-404", "x")).toBe(untouched);
    expect(removeGroup(untouched, "group-404")).toBe(untouched);
    expect(toggleCollapsed(untouched, "group-404")).toBe(untouched);
    // 无变化的归属变更同样原引用
    expect(assignColumn(untouched, "start", "group-1")).toBe(untouched);
    expect(assignColumn(untouched, "tavern", null)).toBe(untouched);
  });

  it("跨组移动不产生重复归属；移出分组回「未归类」", () => {
    let view = addGroup(emptyGroupingView(), "甲");
    view = addGroup(view, "乙");
    view = assignColumn(view, "start", "group-1");
    view = assignColumn(view, "start", "group-2");
    expect(view.groups[0]?.columns).toEqual([]);
    expect(view.groups[1]?.columns).toEqual(["start"]);
    view = assignColumn(view, "start", null);
    expect(view.groups[1]?.columns).toEqual([]);
    expect(layoutColumns(view, ["start"]).ungrouped).toEqual(["start"]);
    expectExactPartition(view, ["start", "tavern"]);
  });

  it("addGroup id 避撞且名字留空回退「新分组」", () => {
    let view = addGroup(emptyGroupingView(), "甲");
    view = addGroup(view, "");
    view = addGroup(view, "丙");
    expect(view.groups.map((group) => group.id)).toEqual([
      "group-1",
      "group-2",
      "group-3",
    ]);
    expect(view.groups[1]?.name).toBe("新分组");
    // 删中间一个后新建仍不与既有 id 撞
    view = removeGroup(view, "group-1");
    view = addGroup(view, "丁");
    expect(view.groups.map((group) => group.id)).toEqual([
      "group-2",
      "group-3",
      "group-1",
    ]);
  });

  it("删除分组：成员回「未归类」，折叠态一并清掉", () => {
    let view = assignColumn(
      addGroup(emptyGroupingView(), "序章"),
      "start",
      "group-1",
    );
    view = toggleCollapsed(view, "group-1");
    const removed = removeGroup(view, "group-1");
    expect(removed.groups).toEqual([]);
    expect(removed.collapsed).toEqual([]);
    expect(layoutColumns(removed, ["start"]).ungrouped).toEqual(["start"]);
  });

  it("序列化字节稳定（字段序固定）且往返等价", () => {
    const view = assignColumn(
      addGroup(emptyGroupingView(), "序章"),
      "start",
      "group-1",
    );
    const text = serializeGroupingView(view);
    expect(text).toBe(serializeGroupingView(parseGroupingView(text)));
    expect(Object.keys(JSON.parse(text) as object)).toEqual([
      "version",
      "groups",
      "collapsed",
    ]);
    expect(Object.keys((JSON.parse(text) as { groups: object[] }).groups[0]!)).toEqual([
      "id",
      "name",
      "columns",
    ]);
  });
});

describe("混沌游走：200 步混合编辑，不变量恒成立", () => {
  it("分组面与故事面互不干扰；每步划分不变量 + 往返稳定", () => {
    const prng = mulberry32(20260928);
    let story = makeStory();
    const initialStory = story;
    let view = emptyGroupingView();
    const session = new EditorSession(story);
    let counter = 0;

    for (let step = 0; step < 200; step += 1) {
      const storySnapshot = JSON.stringify(story);
      const ids = idsOf(story);
      const roll = prng();
      let storyTouched = false;

      if (roll < 0.12) {
        view = addGroup(view, `组${counter}`);
        counter += 1;
      } else if (roll < 0.2) {
        const groupId = view.groups[0]?.id;
        if (groupId !== undefined) view = removeGroup(view, groupId);
      } else if (roll < 0.28) {
        const groupId = view.groups[0]?.id;
        if (groupId !== undefined) {
          view = renameGroup(view, groupId, `改名${counter}`);
          counter += 1;
        }
      } else if (roll < 0.58) {
        const columnId =
          ids.length === 0 ? undefined : ids[Math.floor(prng() * ids.length)];
        const groupId =
          view.groups[Math.floor(prng() * (view.groups.length + 1))]?.id ?? null;
        if (columnId !== undefined) {
          view = assignColumn(
            view,
            columnId,
            prng() < 0.85 ? groupId : null,
          );
        }
      } else if (roll < 0.68) {
        const groupId = view.groups[0]?.id;
        if (groupId !== undefined) view = toggleCollapsed(view, groupId);
      } else if (roll < 0.78) {
        storyTouched = true;
        story = addColumn(story, { kind: prng() < 0.5 ? "flow" : "scene" })
          .story;
      } else if (roll < 0.88) {
        storyTouched = true;
        const candidates = ids.filter((id) => id !== story.entry);
        const target =
          candidates.length === 0
            ? undefined
            : candidates[Math.floor(prng() * candidates.length)];
        if (target !== undefined) {
          const next = removeColumn(story, target);
          if (next !== null) {
            story = next;
            // 宿主接线：删列后裁剪悬空成员（App.vue 的 syncGroupingColumns 同语义）
            view = pruneGroupingView(view, idsOf(story));
          }
        }
      } else if (roll < 0.98) {
        storyTouched = true;
        const from = ids.length === 0 ? undefined : ids[Math.floor(prng() * ids.length)];
        if (from !== undefined) {
          const to = `${from}_r${counter}`;
          counter += 1;
          const next = renameColumn(story, from, to);
          if (next !== null) {
            story = next;
            // 宿主接线：改名同步成员 id（App.vue 的 renameColumn 同语义）
            view = renameColumnMember(view, from, to);
          }
        }
      }

      // 分组面操作不得触碰故事树（逐字节）
      if (!storyTouched) expect(JSON.stringify(story)).toBe(storySnapshot);
      expectExactPartition(view, idsOf(story));
      expect(parseGroupingView(serializeGroupingView(view))).toEqual(view);
      // 分组操作面恒不经过会话：会话基线仍是初始故事，零 undo、零 dirty
      expect(session.story).toBe(initialStory);
      expect(session.undoDepth).toBe(0);
      expect(session.dirty).toBe(false);
    }
  });
});

describe("源码互锁：视图偏好不得进会话 / 故事树", () => {
  it("列侧栏走纯函数布局与分组 API，且完全不引用 session", () => {
    expect(columnListSource).not.toMatch(/session/);
    expect(columnListSource).toContain("layoutColumns");
    expect(columnListSource).toContain('inject<ColumnGroupingApi>("columnGroupingApi")');
  });

  it("宿主用注入式 store 且 provide/inject 键一致；key 前缀只在纯逻辑模块出现", () => {
    expect(appSource).toContain("createColumnGroupingStore");
    expect(appSource).toContain('provide("columnGroupingApi"');
    expect(appSource).not.toContain("lingfan-editor-colgroups");
    expect(columnListSource).not.toContain("lingfan-editor-colgroups");
    expect(COLUMN_GROUPING_KEY_PREFIX).toBe("lingfan-editor-colgroups:");
  });

  it("分组视图随 story.id 归位（不照抄「仅 onMounted 读一次」的旧写法）", () => {
    expect(appSource).toMatch(/watch\(\s*\(\)\s*=>\s*story\.value\.id/u);
    expect(appSource).toContain("groupingStore.load");
  });
});

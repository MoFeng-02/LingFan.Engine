/**
 * 资源树模型：分组/排序/种类/只读判据 + 遍历。
 * 拟态旅程形态：喂真实工程的资源集，断言树的形状与排除口径。
 */
import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "@lingfan/editor";
import {
  buildResourceTree,
  COLLAPSED_DIRS_LIMIT,
  createCollapsedDirsStore,
  flattenResources,
  isReadOnlyPath,
  kindOfPath,
  RESOURCE_TREE_COLLAPSED_KEY_PREFIX,
  type ResourceNode,
} from "../../apps/editor/src/resourceTree";

/** 真实工程（playground Resources）的文件集 —— 形状同磁盘实测 */
const realPaths = [
  "Audio/chest_drawer_open.mp3",
  "Audio/crickets_night01.mp3",
  "Images/lingfan.png",
  "Lang/en/main.json",
  "Lang/en/title_main.json",
  "Stories/end.json",
  "Stories/inn.json",
  "Stories/square.json",
  "Stories/stage_demo.json",
  "Stories/start.json",
  "Video/m1.mp4",
  "Video/m2.mp4",
  "project.json",
];

const names = (nodes: readonly ResourceNode[]): string[] => nodes.map((n) => n.name);
const find = (nodes: readonly ResourceNode[], name: string): ResourceNode | undefined => {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = find(n.children, name);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

describe("kindOfPath · 资源种类按后缀判", () => {
  it("各类资源落对桶", () => {
    expect(kindOfPath("Stories/start.json")).toBe("story");
    expect(kindOfPath("Stories/tavern.story")).toBe("story");
    expect(kindOfPath("Lang/en/main.json")).toBe("lang");
    expect(kindOfPath("Images/lingfan.png")).toBe("image");
    expect(kindOfPath("Audio/x.mp3")).toBe("audio");
    expect(kindOfPath("Video/m2.mp4")).toBe("video");
    expect(kindOfPath("project.json")).toBe("manifest");
    expect(kindOfPath("Saves/slot_1.json")).toBe("saves");
    expect(kindOfPath("README.md")).toBe("other");
  });

  it("加密后缀 `.enc` 看前一层有效后缀（资源类型不因加密而变）", () => {
    expect(kindOfPath("Lang/en/main.json.enc")).toBe("lang");
    expect(kindOfPath("Video/m2.mp4.enc")).toBe("video");
    expect(kindOfPath("Images/x.png.enc")).toBe("image");
  });

  it("`Saves/` 优先于后缀判定（运行时产物不可被后缀伪装成可编辑资源）", () => {
    expect(kindOfPath("Saves/deck.json")).toBe("saves");
    expect(kindOfPath("Saves/nested/deep/x.json")).toBe("saves");
  });
});

describe("isReadOnlyPath · 只读约定", () => {
  it("本批可编辑的只有 .story / manifest / lang", () => {
    expect(isReadOnlyPath("Stories/a.json")).toBe(false);
    expect(isReadOnlyPath("project.json")).toBe(false);
    expect(isReadOnlyPath("Lang/en/main.json")).toBe(false);
  });

  it("Saves 与媒体一律只读", () => {
    expect(isReadOnlyPath("Saves/slot_1.json")).toBe(true);
    expect(isReadOnlyPath("Video/m2.mp4")).toBe(true);
    expect(isReadOnlyPath("Images/x.png")).toBe(true);
  });
});

describe("buildResourceTree · 真实工程", () => {
  const tree = buildResourceTree(realPaths);

  it("顶层：目录在前 + project.json 在后（确定性排序）", () => {
    expect(names(tree)).toEqual([
      "Audio",
      "Images",
      "Lang",
      "Stories",
      "Video",
      "project.json",
    ]);
  });

  it("嵌套两层（Lang/en/*.json）", () => {
    const lang = find(tree, "Lang")!;
    expect(names(lang.children)).toEqual(["en"]);
    expect(names(lang.children[0].children)).toEqual(["main.json", "title_main.json"]);
  });

  it("目录节点标 collapsible、根级 manifest 不标", () => {
    expect(find(tree, "Stories")!.collapsible).toBe(true);
    expect(find(tree, "project.json")!.collapsible).toBe(false);
  });

  it("Saves 显式在树里但只读（不隐藏 —— 隐藏会让用户以为文件丢了）", () => {
    const withSaves = buildResourceTree([...realPaths, "Saves/slot_1.json", "Saves/slot_2.json"]);
    const saves = find(withSaves, "Saves")!;
    expect(saves).toBeDefined();
    expect(saves.readOnly).toBe(true);
    expect(names(saves.children)).toEqual(["slot_1.json", "slot_2.json"]);
    expect(saves.children.every((c) => c.readOnly)).toBe(true);
  });

  it("确定性：同一份文件集两次构建产出同构（序列化后可逐字节比较）", () => {
    expect(JSON.stringify(buildResourceTree(realPaths))).toBe(
      JSON.stringify(buildResourceTree([...realPaths].reverse())),
    );
  });

  it("空输入 / 全点文件 ⇒ 空树（不产生幽灵节点）", () => {
    expect(buildResourceTree([])).toEqual([]);
    expect(buildResourceTree([".hidden", ".git/config"])).toEqual([]);
  });

  it("已存在的目录不会被重复创建（同名文件与目录共存不打架）", () => {
    const mixed = buildResourceTree(["Stories/a.json", "Stories/extra/b.json"]);
    const stories = find(mixed, "Stories")!;
    expect(names(stories.children)).toEqual(["extra", "a.json"]);
  });
});

describe("flattenResources · 遍历", () => {
  it("只出叶子（文件），顺序 = 树序", () => {
    const leaves = flattenResources(buildResourceTree(realPaths));
    const paths = leaves.map((l) => l.path);
    expect(paths).toContain("Stories/start.json");
    expect(paths).toContain("Lang/en/main.json");
    expect(paths).toContain("project.json");
    // 目录不出现在扁平结果里
    expect(paths).not.toContain("Stories");
    expect(paths).not.toContain("Lang");
  });
});

/**
 * 目录收展持久化（T7）：折叠集按工程存本机。
 * 按契约 Mock（内存 KeyValueStorage 替身），覆盖拟态往返 / 故意错误 / 边界三面。
 */
describe("createCollapsedDirsStore · 收展持久化", () => {
  /** 内存存储替身（形状 = `KeyValueStorage` 两方法契约；可注入读取/写入失败） */
  function memoryStorage(
    initial: Record<string, string> = {},
    opts: { failRead?: boolean; failWrite?: boolean } = {},
  ): KeyValueStorage {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key) => {
        if (opts.failRead) throw new Error("storage broken");
        return data.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (opts.failWrite) throw new Error("storage broken");
        data.set(key, value);
      },
    };
  }

  it("拟态旅程：收起两个目录 → 落盘 → 换 store（模拟重开）读回同集；跨工程互不串", () => {
    const storage = memoryStorage();
    const store = createCollapsedDirsStore(storage);
    store.save("demo", new Set(["Stories/", "Audio/"]));
    // 模拟会话重启：新 store 实例、同一存储
    const reopened = createCollapsedDirsStore(memoryStorage({
      [`${RESOURCE_TREE_COLLAPSED_KEY_PREFIX}demo`]: JSON.stringify(["Stories/", "Audio/"]),
    }));
    expect(reopened.load("demo")).toEqual(new Set(["Stories/", "Audio/"]));
    // 工程隔离：另一工程读不到这份折叠集
    expect(reopened.load("other")).toEqual(new Set());
  });

  it("故意错误：坏 JSON / 非数组 / 含非字符串条目 ⇒ 降级空集或剔除（不抛）", () => {
    const key = `${RESOURCE_TREE_COLLAPSED_KEY_PREFIX}demo`;
    expect(createCollapsedDirsStore(memoryStorage({ [key]: "{not-json" })).load("demo")).toEqual(new Set());
    expect(createCollapsedDirsStore(memoryStorage({ [key]: JSON.stringify("Stories/") })).load("demo")).toEqual(new Set());
    expect(createCollapsedDirsStore(memoryStorage({ [key]: JSON.stringify({ a: 1 }) })).load("demo")).toEqual(new Set());
    expect(
      createCollapsedDirsStore(memoryStorage({ [key]: JSON.stringify(["Stories/", "", 42, null]) })).load("demo"),
    ).toEqual(new Set(["Stories/"]));
  });

  it("边界：无存储 / 读失败 / 写失败 / 空工程 id / 超限截断", () => {
    // undefined 存储 = 无持久化（读写皆空操作）
    expect(createCollapsedDirsStore(undefined).load("demo")).toEqual(new Set());
    expect(() => createCollapsedDirsStore(undefined).save("demo", new Set(["A/"]))).not.toThrow();
    // 读失败 = 空集；写失败 = 静默（仅本次会话有效）
    expect(createCollapsedDirsStore(memoryStorage({}, { failRead: true })).load("demo")).toEqual(new Set());
    expect(() => createCollapsedDirsStore(memoryStorage({}, { failWrite: true })).save("demo", new Set(["A/"]))).not.toThrow();
    // 空工程 id = 不读写（存储原值不动）
    const storage = memoryStorage({ [`${RESOURCE_TREE_COLLAPSED_KEY_PREFIX}demo`]: `["Stories/"]` });
    createCollapsedDirsStore(storage).save("", new Set(["X/"]));
    expect(storage.getItem(`${RESOURCE_TREE_COLLAPSED_KEY_PREFIX}demo`)).toBe(`["Stories/"]`);
    // 超限截断（目录数远小于上限；截断而非报错——视图偏好不值得拦人）
    const bloated = Array.from({ length: COLLAPSED_DIRS_LIMIT + 50 }, (_, i) => `Dir${i}/`);
    const loaded = createCollapsedDirsStore(
      memoryStorage({ [`${RESOURCE_TREE_COLLAPSED_KEY_PREFIX}demo`]: JSON.stringify(bloated) }),
    ).load("demo");
    expect(loaded.size).toBe(COLLAPSED_DIRS_LIMIT);
  });
});

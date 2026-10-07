/**
 * 故事章节树判据测试（**拟态用户旅程** + **边界条件** + **回归**）。
 *
 * 夹具取自真实工程的形态：
 * - `Stories/` 1 层分章（chapter1/chapter1.story …）＋ 一个未分章的 `showcase`
 * - 4 个 `type=game`（3 章节 + showcase）＋ 7 个 `type=menu`
 * - 另有 **0 层平铺**形态（`Stories/start.json`）⇒ 另一组夹具
 *
 * 三条核心约定（都是设计决策，不是实现细节）：
 * ① **分组只看 `type`，绝不看目录名**（作者可能把剧情放进 `system/`）
 * ② **任意深度递归**，不写死「一级 = 章节」
 * ③ **0 层平铺退化**为无章节分组的全列表，**不报错**
 */
import { describe, expect, it } from "vitest";
import {
  buildChapterIndex,
  chapterDirOf,
  chapterGroupOf,
  chapterLabelOf,
  chapterSummaryText,
  type ChapterInput,
} from "../../packages/editor/src/chapters";
import type { StoryColumn } from "@lingfan/engine";

function col(id: string, type?: "game" | "menu" | "ui", kind: "flow" | "scene" = "flow"): StoryColumn {
  const base: StoryColumn = {
    id,
    kind,
    commands: Array.from({ length: 10 }, (_, i) => ({ op: "say", text: `${id}-${i}` })),
  };
  return type === undefined ? base : { ...base, type };
}

/** 用户真实工程：1 层分章 + 混合类型 */
const realInputs: ChapterInput[] = [
  { path: "Stories/chapter1/chapter1.story", column: col("chapter1_start") },
  { path: "Stories/chapter2/chapter2.story", column: col("forest_entry") },
  { path: "Stories/chapter3/chapter3.story", column: col("cavern") },
  //关键反例：**`showcase` 在 system/ 目录下但type=game** ⇒ 不能按目录分组
  { path: "Stories/system/showcase.story", column: col("showcase") },
  { path: "Stories/system/about.story", column: col("about", "menu") },
  { path: "Stories/system/sandbox.story", column: col("sandbox", "menu") },
  { path: "Stories/system/audio_demo.story", column: col("audio_demo", "menu") },
  { path: "Stories/title/title_main.story", column: col("title_main", "menu") },
];

/** 演示工程：0 层平铺 */
const flatInputs: ChapterInput[] = [
  { path: "Stories/start.json", column: col("start") },
  { path: "Stories/inn.json", column: col("inn") },
  { path: "Stories/square.json", column: col("square", "menu") },
];

describe("章节树 · 分组**只看 type，不看目录**（核心约定）", () => {
  it("**回归：system/showcase 在界面目录下但 type=game ⇒ 归剧情组**", () => {
    const index = buildChapterIndex(realInputs);
    const showcase = index.story.find((n) => n.id === "showcase");
    expect(showcase, "showcase 是剧情，不该因目录名 system 被归到界面组").toBeDefined();
    expect(index.ui.find((n) => n.id === "showcase")).toBeUndefined();
  });

  it("真实分布：4 个剧情（3 章节 + showcase）/ 4 个界面（夹具内）", () => {
    const index = buildChapterIndex(realInputs);
    expect(index.story.map((n) => n.id).sort()).toEqual([
      "cavern",
      "chapter1_start",
      "forest_entry",
      "showcase",
    ]);
    expect(index.ui.map((n) => n.id).sort()).toEqual([
      "about",
      "audio_demo",
      "sandbox",
      "title_main",
    ]);
  });

  it("**`type` 缺省 = game** ⇒ 老工程零改动全进剧情组", () => {
    const index = buildChapterIndex(flatInputs);
    // 排序按路径码元序 ⇒ inn 在 start 前
    expect(index.story.map((n) => n.id)).toEqual(["inn", "start"]);
    expect(index.ui.map((n) => n.id)).toEqual(["square"]);
  });

  it("`ui` 类型也归界面组（与 menu 同组——两者都不进历史）", () => {
    expect(chapterGroupOf({ type: "ui" })).toBe("ui");
    expect(chapterGroupOf({ type: "menu" })).toBe("ui");
    expect(chapterGroupOf({})).toBe("story");
  });
});

describe("章节树 · **任意深度递归**（不写死层数）", () => {
  it("3 层嵌套：目录链完整成为分组路径", () => {
    const deep: ChapterInput[] = [
      { path: "Stories/part1/act1/scene_a.story", column: col("a") },
      { path: "Stories/part1/act2/scene_b.story", column: col("b") },
    ];
    const index = buildChapterIndex(deep);
    // 目录键是**剥掉 `Stories/` 前缀后**的相对链（容器根不算章节）
    expect(index.dirs.map((d) => d.path).sort()).toEqual(["part1/act1/", "part1/act2/"]);
    expect(index.dirs[0]?.children).toHaveLength(1);
  });

  it("**目录分组不分深度**（1 层与 3 层同一套判据）", () => {
    const one = buildChapterIndex([{ path: "Stories/c1/a.story", column: col("a") }]);
    const three = buildChapterIndex([
      { path: "Stories/x/y/z/a.story", column: col("a") },
    ]);
    expect(one.dirs).toHaveLength(1);
    expect(three.dirs).toHaveLength(1);
    // 深度只体现在路径里，不影响分组逻辑
    expect(three.dirs[0]?.path).toBe("x/y/z/");
  });

  it("同目录多场景 ⇒ 归到同一分组", () => {
    const index = buildChapterIndex(realInputs);
    const system = index.dirs.find((d) => d.path === "system/");
    expect(system?.children.map((c) => c.id).sort()).toEqual([
      "about",
      "audio_demo",
      "sandbox",
      "showcase",
    ]);
  });
});

describe("章节树 · **0 层平铺退化**（不报错）", () => {
  it("平铺工程 ⇒ dirs 为空 + flat=true", () => {
    const index = buildChapterIndex(flatInputs);
    expect(index.dirs).toEqual([]);
    expect(index.flat).toBe(true);
  });

  it("平铺工程仍正确分组（不因无目录而丢场景）", () => {
    const index = buildChapterIndex(flatInputs);
    expect(index.story).toHaveLength(2);
    expect(index.ui).toHaveLength(1);
  });

  it("章节名：平铺时取文件名去后缀", () => {
    const index = buildChapterIndex(flatInputs);
    expect(index.story.find((n) => n.id === "start")?.label).toBe("start");
  });
});

describe("章节树 · 章节名**取目录名**（作者的分章意图）", () => {
  it("**目录名优先于文件名**（chapter1/chapter1 ⇒ 显示 chapter1）", () => {
    expect(chapterLabelOf("Stories/chapter1/chapter1.story")).toBe("chapter1");
  });

  it("目录名 ≠ 文件名时取目录名", () => {
    expect(chapterLabelOf("Stories/system/about.story")).toBe("system");
  });

  it("无目录 ⇒ 取文件名去后缀", () => {
    expect(chapterLabelOf("Stories/start.json")).toBe("start");
    expect(chapterLabelOf("Stories/noext")).toBe("noext");
  });

  it("目录判定：**剥掉 `Stories/` 前缀**（容器根不算章节）", () => {
    expect(chapterDirOf("Stories/a/b.story")).toBe("a/");
    //`Stories/start.json` 是**平铺**（深一层只是分组，不是编排章节）
    expect(chapterDirOf("Stories/start.json")).toBe("");
    expect(chapterDirOf("start.json")).toBe("");
    // 3 层：完整相对链都保留（任意深度）
    expect(chapterDirOf("Stories/x/y/z/a.story")).toBe("x/y/z/");
  });

  it("**容器根不是章节**：`Stories/start.json` 的章节名是 start 不是 Stories", () => {
    expect(chapterLabelOf("Stories/start.json")).toBe("start");
  });
});

describe("章节树 · 边界条件", () => {
  it("空输入⇒ 空索引 + flat=true（不是崩溃）", () => {
    const index = buildChapterIndex([]);
    expect(index.story).toEqual([]);
    expect(index.ui).toEqual([]);
    expect(index.dirs).toEqual([]);
    expect(index.flat).toBe(true);
    expect(chapterSummaryText(index)).toBe("无场景");
  });

  it("汇总文案：有场景时分类计数", () => {
    expect(chapterSummaryText(buildChapterIndex(realInputs))).toBe("4 个剧情 · 4 个界面");
  });

  it("只有剧情时不提界面（不显示「0 个界面」）", () => {
    const index = buildChapterIndex([{ path: "Stories/a.story", column: col("a") }]);
    expect(chapterSummaryText(index)).toBe("1 个剧情");
  });

  it("命令条数：flow 看 commands / scene 看 entry", () => {
    const sceneCol: StoryColumn = {
      id: "s",
      kind: "scene",
      elements: [],
      entry: [{ op: "say", text: "a" }, { op: "say", text: "b" }],
    };
    const index = buildChapterIndex([{ path: "Stories/s.story", column: sceneCol }]);
    expect(index.story[0]?.commandCount).toBe(2);
  });

  it("**排序确定性**（输入顺序不同 ⇒ 输出逐字节相同）", () => {
    const a = buildChapterIndex(realInputs);
    const b = buildChapterIndex([...realInputs].reverse());
    expect(JSON.stringify(a.story)).toBe(JSON.stringify(b.story));
    expect(JSON.stringify(a.dirs)).toBe(JSON.stringify(b.dirs));
  });

  it("同名不同路径的两个章节排序稳定（按完整路径不按显示名）", () => {
    const dup: ChapterInput[] = [
      { path: "Stories/b/chapter1.story", column: col("x") },
      { path: "Stories/a/chapter1.story", column: col("y") },
    ];
    const index = buildChapterIndex(dup);
    // 显示名相同，但按路径排序 ⇒ 稳定
    expect(index.dirs.map((d) => d.path)).toEqual(["a/", "b/"]);
    expect(index.story.map((n) => n.id)).toEqual(["y", "x"]);
  });
});

/**
 * **按组过滤的目录**（`storyDirs` / `uiDirs`）。
 *
 * 为何要拆：面板**先按 `type` 分组**展示（剧情 / 界面），而目录是**作者的编排**
 * ——两者**正交**：一个目录可同时含剧情与界面。
 * 用全局 `dirs` 会让界面组的目录里混进剧情节点。
 */
describe("章节目录 · 按组过滤（storyDirs / uiDirs）", () => {
  it("**目录跟着 type 走**：同一目录里的剧情与界面各归其组，children 不交叉", () => {
    const index = buildChapterIndex([
      { path: "Stories/system/about.story", column: col("about", "menu") },
      { path: "Stories/system/sandbox.story", column: col("sandbox") },
    ]);
    expect(index.storyDirs).toHaveLength(1);
    expect(index.storyDirs[0]?.children.map((n) => n.id)).toEqual(["sandbox"]);
    expect(index.uiDirs).toHaveLength(1);
    expect(index.uiDirs[0]?.children.map((n) => n.id)).toEqual(["about"]);
    // 全局 `dirs` 仍含两者（给「按目录浏览」这类不分组的视图）
    expect(index.dirs[0]?.children).toHaveLength(2);
  });

  it("**分组版与全局版同序**（同一目录的 path/label 一致，只是 children 不同）", () => {
    const index = buildChapterIndex([
      { path: "Stories/chapter1/a.story", column: col("a") },
      { path: "Stories/chapter2/b.story", column: col("b", "menu") },
    ]);
    expect(index.storyDirs.map((d) => d.path)).toEqual(["chapter1/"]);
    expect(index.uiDirs.map((d) => d.path)).toEqual(["chapter2/"]);
    expect(index.storyDirs[0]?.label).toBe(index.dirs[0]?.label);
  });

  it("**平铺工程**：两组目录均为空（退化为平铺列表，不报错）", () => {
    const index = buildChapterIndex([{ path: "Stories/start.json", column: col("start") }]);
    expect(index.storyDirs).toEqual([]);
    expect(index.uiDirs).toEqual([]);
    expect(index.flat).toBe(true);
  });

  it("**排序确定性**（输入顺序不同 ⇒ 分组版逐字节相同）", () => {
    const inputs: ChapterInput[] = [
      { path: "Stories/b/x.story", column: col("x") },
      { path: "Stories/a/y.story", column: col("y", "menu") },
      { path: "Stories/a/z.story", column: col("z") },
    ];
    const a = buildChapterIndex(inputs);
    const b = buildChapterIndex([...inputs].reverse());
    expect(JSON.stringify(a.storyDirs)).toBe(JSON.stringify(b.storyDirs));
    expect(JSON.stringify(a.uiDirs)).toBe(JSON.stringify(b.uiDirs));
  });
});

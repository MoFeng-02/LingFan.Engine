/**
 * 写回**保真**守卫（写回不得拍平作者的文件编排）。
 *
 * **被治的缺陷**：写回凭 `column.id` 重算 `Stories/<id>.json`
 * ⇒ 保存一次就把作者的**章节目录编排** + **`.story` 文本形态**抹平，
 * 原文件还被判「陈旧」删除。
 *
 * 判据口径（取自真实工程形态）：
 * ① 写回**路径不变**（章节层级 + 文件名）
 * ② 写回**扩展名不变**（`.story` 不变 `.json`）
 * ③ **零删除**（原文件不是「陈旧」）
 * ④ `type` 必须写回（漏了 ⇒ 菜单场景下次打开变成 game，**不可逆**）
 * ⑤ `sourcePath` 只表达**例外**（非默认路径才显式写）——保证「保存后重开」深等
 */
import { describe, expect, it } from "vitest";
import {
  assembleProject,
  diffProjectFiles,
  MANIFEST_FILE,
  serializeColumnDocument,
  serializeProject,
} from "@lingfan/engine";

const MANIFEST = { formatVersion: 1, id: "demo", entry: "chapter1" };
/** 单列夹具用的清单（entry 指向该列 id） */
const MANIFEST_A = { formatVersion: 1, id: "demo", entry: "a" };

/** 真实工程形态：章节分目录 + `.story` 文本 + menu 类型 */
function realProjectFiles(): Map<string, string> {
  const col = (id: string, type?: string): string =>
    JSON.stringify({
      formatVersion: 1,
      columns: [
        type === undefined
          ? { id, kind: "flow", commands: [] }
          : { id, kind: "flow", type, commands: [] },
      ],
    });
  return new Map([
    ["Stories/chapter1/chapter1.story", col("chapter1")],
    ["Stories/system/about.story", col("about", "menu")],
    ["Stories/title/title_main.story", col("title_main", "menu")],
  ]);
}

function loadReal(): ReturnType<typeof assembleProject> {
  return assembleProject(MANIFEST, realProjectFiles());
}

describe("写回保真 · **不拍平**", () => {
  it("路径与扩展名**完全不变**（章节层级 + `.story` 都保住）", () => {
    const { files } = serializeProject(loadReal(), MANIFEST);
    const storyPaths = [...files.keys()].filter((p) => p.startsWith("Stories/"));
    expect(storyPaths.sort()).toEqual([
      "Stories/chapter1/chapter1.story",
      "Stories/system/about.story",
      "Stories/title/title_main.story",
    ]);
  });

  it("**零删除**（原文件不是「陈旧」）", () => {
    const before = realProjectFiles();
    const { files } = serializeProject(loadReal(), MANIFEST);
    const diff = diffProjectFiles(files, before);
    expect([...diff.deletes]).toEqual([]);
  });

  it("`type` 写回（漏了 ⇒ 菜单场景下次打开变成 game，且不可逆）", () => {
    const { files } = serializeProject(loadReal(), MANIFEST);
    expect(files.get("Stories/system/about.story")).toContain("menu");
    expect(files.get("Stories/title/title_main.story")).toContain("menu");
    // game 是缺省 ⇒ 不写（保持文件干净）
    expect(files.get("Stories/chapter1/chapter1.story")).not.toContain('"type"');
  });

  it("`sourcePath` **不进文件内容**（编辑期元数据，写进去会自指）", () => {
    const { files } = serializeProject(loadReal(), MANIFEST);
    for (const [, text] of files) {
      expect(text).not.toContain("sourcePath");
    }
  });

  it("**往返一致**：写回 → 重开 ⇒ 故事深等（编辑器最核心的不变量）", () => {
    // 夹具用 `.json` 承载：写回**保路径**与「内容用什么格式」是两个正交问题。
    // `.story` 路径 + JSON 内容会被组装器按文本解析（那是另一个待治项——
    // 「.story 文本形态写回」；本守卫只锁「不拍平」）。
    const files = new Map([
      ["Stories/a.json", JSON.stringify({ formatVersion: 1, columns: [{ id: "a", kind: "flow", commands: [] }] })],
    ]);
    const first = assembleProject(MANIFEST_A, files);
    const product = serializeProject(first, MANIFEST_A);
    // `assembleProject` 的第二参**只吃 Stories/**（清单单独传）⇒ 排除 project.json
    const storyFiles = new Map(
      [...product.files].filter(([p]) => p !== MANIFEST_FILE),
    );
    expect(assembleProject(MANIFEST_A, storyFiles)).toEqual(first);
  });

  it("**幂等**：再保存一次 ⇒ 零写零删", () => {
    const files = new Map([
      ["Stories/a.json", JSON.stringify({ formatVersion: 1, columns: [{ id: "a", kind: "flow", commands: [] }] })],
    ]);
    const first = assembleProject(MANIFEST_A, files);
    const once = serializeProject(first, MANIFEST_A).files;
    const second = diffProjectFiles(serializeProject(first, MANIFEST_A).files, once);
    expect([...second.changes.keys()]).toEqual([]);
    expect([...second.deletes]).toEqual([]);
  });
});

describe("写回保真 · 冲突与边界", () => {
  it("**同来源文件的多列 ⇒ 写成多列形态**（一个文件承载一章的场景）", () => {
    // 真实工程形态：`chapter1.story` 有 4 列（`chapter1_start` / `_explore` / …）。
    // 「共享来源文件」不是冲突 ⇒ 正确口径：**按来源文件分组**，
    // 组内多列写成 `{columns:[…]}` 形态。
    const story = {
      formatVersion: 1,
      id: "demo",
      entry: "a",
      columns: [
        { id: "a", kind: "flow", commands: [], sourcePath: "Stories/ch1.json" },
        { id: "a_explore", kind: "flow", commands: [], sourcePath: "Stories/ch1.json" },
      ],
    } as never;
    const { files } = serializeProject(story, MANIFEST);
    // 一个文件、不报错、内容是多列形态
    const storyPaths = [...files.keys()].filter((p) => p.startsWith("Stories/"));
    expect(storyPaths).toEqual(["Stories/ch1.json"]);
    const text = files.get("Stories/ch1.json")!;
    expect(JSON.parse(text).columns).toHaveLength(2);
    // 往返可逆（parseStoryFile 按内容识别两种形态）
    const reopened = assembleProject(
      { formatVersion: 1, id: "demo", entry: "a" },
      new Map([["Stories/ch1.json", text]]),
    );
    expect(reopened.columns.map((c) => c.id)).toEqual(["a", "a_explore"]);
  });

  it("**越界路径不生成**（`sourcePath` 不可信 ⇒ 退回默认，不写目录逃逸）", () => {
    const story = {
      formatVersion: 1,
      id: "demo",
      entry: "a",
      columns: [
        { id: "a", kind: "flow", commands: [], sourcePath: "../../evil.json" },
      ],
    } as never;
    const { files } = serializeProject(story, MANIFEST);
    expect([...files.keys()]).toContain("Stories/a.json");
    // 绝不写到Stories/ 之外
    expect([...files.keys()].every((p) => p.startsWith("Stories/") || p === MANIFEST_FILE)).toBe(true);
  });

  it("**单列写回同样保真**（编辑器保存一列也不该拍平它）", () => {
    const loaded = loadReal();
    const about = loaded.columns.find((c) => c.id === "about")!;
    const product = serializeColumnDocument(
      { ...loaded, columns: [about] },
      "about",
    );
    // 写回 `Stories/system/about.story`（不是 `Stories/about.json`）
    expect([...product.files.keys()]).toEqual(["Stories/system/about.story"]);
  });

  it("新建列（无 sourcePath）⇒ 默认路径，且往返一致", () => {
    const story = {
      formatVersion: 1,
      id: "demo",
      entry: "a",
      columns: [{ id: "a", kind: "flow", commands: [] }],
    } as never;
    const { files, written } = serializeProject(story, MANIFEST);
    expect([...files.keys()]).toContain("Stories/a.json");
    // 回执给出落盘路径（编辑器据此记账，不必猜）
    expect(written.get("a")).toBe("Stories/a.json");
  });

  it("**`sourcePath` 只表达例外**（默认路径不显式存 ⇒ 往返深等的前提）", () => {
    const story = assembleProject(MANIFEST_A, new Map([
      ["Stories/a.json", JSON.stringify({ formatVersion: 1, columns: [{ id: "a", kind: "flow", commands: [] }] })],
    ]));
    // 默认路径 ⇒ 列上**没有** sourcePath 字段
    expect(story.columns[0]?.sourcePath).toBeUndefined();
  });
});

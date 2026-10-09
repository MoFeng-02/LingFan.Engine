/**
 * 容器判据的**源级互锁**：契约容器集合与默认 flex 排布分层的差集被钉死。
 *
 * 契约判「容器」管的是**结构合法性**（能否承载子元素）；渲染层还要再分一层——
 * 网格、画布、边框、滚动这几型虽然能装子元素，排布语义却由各自的专用分支决定，
 * 不走默认 flex。两个判据是**包含关系**而非同一件事，合并会同时丢掉两头的意思。
 *
 * 差集一旦被悄悄改小或改大，受害面很广：flex 默认排布会渗进 grid 的轨道计算，
 * 或反过来让某个容器退回无排布。本测试把契约集合与差集写死在断言里，
 * 契约新增容器类型时必须显式决定它是否走默认 flex。
 *
 * 判据在渲染层是模块私有常量（不对外导出），故从源码文本提取。
 */
import { describe, expect, it } from "vitest";
import { ELEMENT_CONTAINER_TYPES } from "@lingfan/engine";

/** 渲染器全部源码，键 = 仓库相对路径（前端不碰文件系统，改用打包器读取） */
const RENDERER_SOURCES = import.meta.glob(
  "../../packages/ui/src/element/renderers/**/*.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

/** 判据所在文件 */
const CONTAINER_FILE = "container.ts";

/** 现行差集：能装子元素但排布不走默认 flex 的 6 型 */
const NON_FLEX_CONTAINERS = [
  "grid",
  "canvas",
  "border",
  "scroll",
  "scrollviewer",
  "viewport",
] as const;

/** 去注释（注释里列类型名不算判据） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\w])\/\/.*$/gm, "$1");
}

function containerSource(): string {
  const entry = Object.entries(RENDERER_SOURCES).find(([path]) =>
    path.endsWith(`/${CONTAINER_FILE}`),
  );
  return stripComments(entry?.[1] ?? "");
}

/** 提取 `const 名: 类型 = new Set([ "a", "b", … ]);` 里的字面量成员 */
function setMembers(source: string, name: string): string[] {
  const decl = new RegExp(
    `const\\s+${name}\\b[^=]*=\\s*new\\s+Set\\s*\\(([\\s\\S]*?)\\)\\s*;`,
  ).exec(source);
  const body = decl?.[1] ?? "";
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** 判据消费点形态：`FLEX_CONTAINERS.has(`，**不**匹配 `NON_FLEX_CONTAINERS.has(` */
const FLEX_CONSUME = /(?<![\w])FLEX_CONTAINERS\.has\(/;

describe("容器判据 · 源级互锁（结构合法性 vs 默认 flex 排布）", () => {
  it("扫描面覆盖渲染器全目录且含判据文件（防假绿）", () => {
    const paths = Object.keys(RENDERER_SOURCES);
    expect(paths.length).toBeGreaterThanOrEqual(9);
    expect(paths.some((p) => p.endsWith(`/${CONTAINER_FILE}`))).toBe(true);
  });

  it("契约容器集合为 18 项，差集为 6 项（含 grid、canvas、border、scroll、scrollviewer、viewport）", () => {
    expect(ELEMENT_CONTAINER_TYPES.size).toBe(18);
    expect([...NON_FLEX_CONTAINERS]).toEqual([
      "grid",
      "canvas",
      "border",
      "scroll",
      "scrollviewer",
      "viewport",
    ]);
  });

  it("差集字面量与断言逐项相等（多一项少一项都红）", () => {
    const members = setMembers(containerSource(), "NON_FLEX_CONTAINERS");
    expect(members).toHaveLength(6);
    expect(new Set(members)).toEqual(new Set(NON_FLEX_CONTAINERS));
  });

  it("差集 ⊆ 契约容器集合（不许写契约里不存在的类型）", () => {
    const outside = NON_FLEX_CONTAINERS.filter(
      (t) => !ELEMENT_CONTAINER_TYPES.has(t),
    );
    expect(outside).toEqual([]);
  });

  it("两判据未合并：flex 侧由契约集合减去差集派生，而非另写一份名单", () => {
    const source = containerSource();
    expect(source).toContain("ELEMENT_CONTAINER_TYPES");
    // 派生式：契约集合过滤掉差集成员
    expect(source).toMatch(
      /\[\.\.\.ELEMENT_CONTAINER_TYPES\][\s\S]*?filter\([\s\S]*?NON_FLEX_CONTAINERS\.has\(/,
    );
    // 全文件只有两个集合字面量（差集 + 派生结果），派生结果里不写第二份类型名
    expect(source.match(/new Set\(/g) ?? []).toHaveLength(2);
    expect(setMembers(source, "FLEX_CONTAINERS")).toEqual([]);
  });

  it("派生结果逐项等于契约集合减去差集（12 项，顺序一致）", () => {
    const derived = [...ELEMENT_CONTAINER_TYPES].filter(
      (t) => !(NON_FLEX_CONTAINERS as readonly string[]).includes(t),
    );
    expect(derived).toEqual([
      "panel",
      "frame",
      "window",
      "dialogbox",
      "choicebox",
      "infobox",
      "overlay",
      "popup",
      "vbox",
      "hbox",
      "stack",
      "stackpanel",
    ]);
    // 源码里那份差集与断言里的差集一致时，两者派生结果必然同序
    const sourceDerived = [...ELEMENT_CONTAINER_TYPES].filter(
      (t) => !setMembers(containerSource(), "NON_FLEX_CONTAINERS").includes(t),
    );
    expect(derived).toEqual(sourceDerived);
  });

  it("判据消费点只有一处（默认 flex 分支）", () => {
    const callers = Object.keys(RENDERER_SOURCES).filter((path) =>
      FLEX_CONSUME.test(stripComments(RENDERER_SOURCES[path] ?? "")),
    );
    expect(callers.map((p) => p.slice(p.lastIndexOf("/") + 1))).toEqual([
      CONTAINER_FILE,
    ]);
    expect(containerSource().match(new RegExp(FLEX_CONSUME, "g")) ?? [])
      .toHaveLength(1);
  });

  it("机制自证：差集多一项时，它与契约集合的包含关系仍成立但派生结果必变", () => {
    const tampered = new Set([...NON_FLEX_CONTAINERS, "panel"]);
    const derived = [...ELEMENT_CONTAINER_TYPES].filter((t) => !tampered.has(t));
    expect(derived).toHaveLength(11);
    expect(derived).not.toContain("panel");
  });
});

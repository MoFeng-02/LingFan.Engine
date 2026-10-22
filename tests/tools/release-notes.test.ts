/**
 * 发布说明生成的判据测试。
 *
 * 只测纯函数（标题解析、分节归类、成文），不测 `readCommits`——它读的是真实 git 历史，
 * 把历史写进断言等于每提交一次就要改测试。真实聚合由 `pnpm release:notes` 在发版时跑。
 *
 * 为什么值得钉住：发布说明是给人看的第一手材料。分节错了、条目丢了、格式崩了，
 * 读的人不会去翻提交历史核对，只会以为那部分没做——错的很安静。
 */
import { describe, expect, it } from "vitest";

interface ReleaseNotesModule {
  parseSubject: (subject: string) => {
    type?: string;
    scope?: string;
    summary: string;
    conventional: boolean;
  };
  sectionOf: (type?: string) => string;
  renderNotes: (input: {
    version: string;
    commits: { hash: string; subject: string }[];
  }) => string;
}

const releaseNotes = (await import(
  /* @vite-ignore */ new URL("../../scripts/release-notes.mjs", import.meta.url)
    .href
)) as ReleaseNotesModule;
const { parseSubject, sectionOf, renderNotes } = releaseNotes;

describe("提交标题解析", () => {
  it("带范围的约定式标题拆成三段", () => {
    expect(parseSubject("feat(发布面): 编辑器转为可发布包")).toEqual({
      type: "feat",
      scope: "发布面",
      summary: "编辑器转为可发布包",
      conventional: true,
    });
  });

  it("不带范围时 scope 为空，其余照常", () => {
    expect(parseSubject("fix: 修正排序口径")).toEqual({
      type: "fix",
      scope: undefined,
      summary: "修正排序口径",
      conventional: true,
    });
  });

  it("破坏性标记不算类型的一部分", () => {
    expect(parseSubject("feat(api)!: 换掉旧入口").type).toBe("feat");
  });

  it("不符合约定的标题原文照录，不丢内容", () => {
    expect(parseSubject("随手改了点东西")).toEqual({
      type: undefined,
      scope: undefined,
      summary: "随手改了点东西",
      conventional: false,
    });
  });
});

describe("提交类型归节", () => {
  it("四类映射与仓库约定一致", () => {
    expect(sectionOf("feat")).toBe("新增");
    expect(sectionOf("refactor")).toBe("优化");
    expect(sectionOf("perf")).toBe("优化");
    expect(sectionOf("fix")).toBe("修复");
  });

  it("未登记的类型与空类型都不丢，落进其他变更", () => {
    expect(sectionOf("chore")).toBe("其他变更");
    expect(sectionOf(undefined)).toBe("其他变更");
  });
});

describe("发布说明成文", () => {
  const commits = [
    { hash: "aaaaaaa1111", subject: "feat(core): 新增回溯检查点" },
    { hash: "bbbbbbb2222", subject: "fix(core): 修正作用域泄漏" },
    { hash: "ccccccc3333", subject: "chore: 整理忽略项" },
  ];

  it("标题带版本，条目带短哈希与范围", () => {
    const notes = renderNotes({ version: "0.1.2", commits });
    expect(notes).toContain("## v0.1.2");
    expect(notes).toContain("**core**：新增回溯检查点（aaaaaaa）");
    expect(notes).toContain("**core**：修正作用域泄漏（bbbbbbb）");
    expect(notes).toContain("整理忽略项（ccccccc）");
  });

  it("空节被省略——只剩一个节时不该印四个标题", () => {
    const notes = renderNotes({
      version: "0.1.2",
      commits: [{ hash: "ddddddd", subject: "fix: 修一处" }],
    });
    expect(notes).toContain("### 修复");
    expect(notes).not.toContain("### 新增");
    expect(notes).not.toContain("### 优化");
  });

  it("三节都有内容时按新增/优化/修复顺序出现", () => {
    const notes = renderNotes({ version: "0.1.2", commits });
    const order = ["### 新增", "### 修复", "### 其他变更"].map((title) =>
      notes.indexOf(title),
    );
    expect(order.every((index) => index !== -1)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it("没有提交时给一句明确说明，而不是留空白", () => {
    const notes = renderNotes({ version: "0.1.2", commits: [] });
    expect(notes).toContain("本次没有代码提交");
  });

  it("条目数与提交数一致，不静默丢条目", () => {
    const notes = renderNotes({ version: "0.1.2", commits });
    const bulletCount = notes
      .split("\n")
      .filter((line) => line.startsWith("- ")).length;
    expect(bulletCount).toBe(commits.length);
    expect(notes).toContain(`共 ${commits.length} 条提交`);
  });

  // 说明会被 `cat` 拼进别的内容里（发布步骤就是把文件内容交给下一步）。
  // 结尾缺换行时，最后一行会和紧随其后的内容粘成一行，肉眼很难看出是这里的问题。
  it("成文以换行收尾，拼接时不会与后续内容粘连", () => {
    expect(renderNotes({ version: "0.1.2", commits }).endsWith("\n")).toBe(
      true,
    );
    expect(renderNotes({ version: "0.1.2", commits: [] }).endsWith("\n")).toBe(
      true,
    );
  });
});

/**
 * 发布说明生成的判据测试。
 *
 * 只测纯函数（标题解析、正文拆节、分节归类、成文），不测 `readCommits`——它读的是真实
 * git 历史，把历史写进断言等于每提交一次就要改测试。真实聚合由 `pnpm release:notes`
 * 在发版时跑。
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
  parseBodySections: (body: string) => Map<string, string[]>;
  sectionOf: (type?: string) => string;
  renderNotes: (input: {
    version: string;
    commits: { hash: string; subject: string; body?: string }[];
    repoSlug?: string;
    previousTag?: string;
  }) => string;
  repoSlug: () => string | undefined;
}

const releaseNotes = (await import(
  /* @vite-ignore */ new URL("../../scripts/release-notes.mjs", import.meta.url)
    .href
)) as ReleaseNotesModule;
const { parseBodySections, parseSubject, sectionOf, renderNotes } =
  releaseNotes;

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

describe("提交正文拆节", () => {
  it("分节标题下的小圆点条目逐条取出", () => {
    const body = [
      "新增：",
      "- 编辑器补词函数具名出口",
      "- 构建命令补可执行入口",
      "",
      "修复：",
      "- 排序改用码元序",
    ].join("\n");
    expect([...parseBodySections(body)]).toEqual([
      ["新增", ["编辑器补词函数具名出口", "构建命令补可执行入口"]],
      ["修复", ["排序改用码元序"]],
    ]);
  });

  // 提交正文常按 80 列折行。折行后的续行若被当成新条目，一条改动会被拆成两行半句，
  // 读的人会以为那是两处改动。
  it("折行的续行接回上一条，不另起一条", () => {
    const body = [
      "修复：",
      "- 发布步骤改成可重跑，已上架的",
      "  版本自动跳过",
    ].join("\n");
    expect(parseBodySections(body).get("修复")).toEqual([
      "发布步骤改成可重跑，已上架的版本自动跳过",
    ]);
  });

  // 中文之间补空格会把词切断成「可重跑 的」，读起来像错字。
  it("续行拼接只在需要分词时才补空格", () => {
    const chinese = parseBodySections("修复：\n- 改成分节输出\n  再补一条说明");
    expect(chinese.get("修复")?.[0]).toBe("改成分节输出再补一条说明");

    const ascii = parseBodySections("修复：\n- 换成 readCommits\n  with body");
    expect(ascii.get("修复")?.[0]).toBe("换成 readCommits with body");
  });

  // 没有分节标题不等于没有内容。整段说明落在空串这个键下，由调用方按提交类型落位——
  // 提交正文常是一段「为什么这么改」的解释，丢了它发布说明就只剩标题复述。
  it("没有分节标题的正文落在空键下，不被丢弃", () => {
    const sections = parseBodySections("随手写的一段说明，没有分节。");
    expect([...sections.keys()]).toEqual([""]);
    expect(sections.get("")).toEqual(["随手写的一段说明，没有分节。"]);
  });

  it("空正文返回空表", () => {
    expect(parseBodySections("").size).toBe(0);
    expect(parseBodySections("   \n\n  ").size).toBe(0);
  });
});

describe("正文进说明", () => {
  // 只看标题时，正文里那句「为什么改」和「对使用者有什么影响」会全丢掉，
  // 发布说明退化成一行行摘要。
  it("有正文分节时按正文条目成文，标题摘要不再重复出现", () => {
    const notes = renderNotes({
      version: "0.1.2",
      commits: [
        {
          hash: "aaaaaaa1111",
          subject: "fix(发布): 发布动作只在标签上发生",
          body: "修复：\n- 手工触发时不再能推包\n\n其他变更：\n- 补一组判据测试",
        },
      ],
    });
    expect(notes).toContain("**发布**：手工触发时不再能推包（aaaaaaa）");
    expect(notes).toContain("补一组判据测试（aaaaaaa）");
    expect(notes).not.toContain("发布动作只在标签上发生");
    expect(notes).toContain("### 修复");
    expect(notes).toContain("### 其他变更");
  });

  it("没有正文分节的提交仍按标题归类，两种来源可以混在一起", () => {
    const notes = renderNotes({
      version: "0.1.2",
      commits: [
        { hash: "aaaaaaa1111", subject: "feat(core): 加一个出口" },
        {
          hash: "bbbbbbb2222",
          subject: "fix(core): 修一处",
          body: "修复：\n- 修了作用域泄漏",
        },
      ],
    });
    expect(notes).toContain("**core**：加一个出口（aaaaaaa）");
    expect(notes).toContain("**core**：修了作用域泄漏（bbbbbbb）");
  });

  // 正文四节之外的分节标题不丢内容，落到最后一节。
  it("正文里的未登记分节落进其他变更，条目不被丢弃", () => {
    const notes = renderNotes({
      version: "0.1.2",
      commits: [
        {
          hash: "ccccccc3333",
          subject: "chore: 整理",
          body: "重构：\n- 挪了个文件",
        },
      ],
    });
    expect(notes).toContain("挪了个文件（ccccccc）");
  });
});

describe("完整变更链接", () => {
  it("有上一个标签与仓库地址时输出对比链接", () => {
    const notes = renderNotes({
      version: "0.1.3",
      commits: [{ hash: "aaaaaaa1111", subject: "feat: 加东西" }],
      repoSlug: "owner/repo",
      previousTag: "v0.1.2",
    });
    expect(notes).toContain(
      "[v0.1.2...v0.1.3](https://github.com/owner/repo/compare/v0.1.2...v0.1.3)",
    );
  });

  // 首个版本没有可比起点，印一条点开是空 diff 的链接比不印更让人困惑。
  it("缺标签或仓库地址时不输出链接，宁可少一行", () => {
    const commits = [{ hash: "aaaaaaa1111", subject: "feat: 加东西" }];
    expect(
      renderNotes({ version: "0.1.3", commits, repoSlug: "owner/repo" }),
    ).not.toContain("完整变更");
    expect(
      renderNotes({ version: "0.1.3", commits, previousTag: "v0.1.2" }),
    ).not.toContain("完整变更");
  });

  it("上一个标签与当前版本同名时不输出链接", () => {
    const notes = renderNotes({
      version: "0.1.2",
      commits: [{ hash: "aaaaaaa1111", subject: "feat: 加东西" }],
      repoSlug: "owner/repo",
      previousTag: "v0.1.2",
    });
    expect(notes).not.toContain("完整变更");
  });
});

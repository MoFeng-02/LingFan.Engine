/**
 * 工程清单 `description` 的透传契约。
 *
 * 描述是**给玩家看的纯元信息**：生成器把它写进 `project.json#description`，
 * 引擎侧的责任只有三条——形状校验（字符串）、读入后不丢、写回后不变。
 * 本文件钉住这三条，以及「没有描述就不新增该键」（缺省产物逐字节不变的依据）。
 *
 * 不测「描述影响行为」：引擎不据描述改变任何行为，也没有消费点，
 * 拿它做断言只是在守一个不存在的功能。
 */
import { describe, expect, it } from "vitest";
import type { Story, StoryColumn } from "@lingfan-engine/core";
import {
  assembleProject,
  MANIFEST_FILE,
  ProjectAssemblyError,
  serializeProject,
} from "@lingfan-engine/core";

const COLUMN: StoryColumn = {
  id: "start",
  kind: "flow",
  commands: [{ op: "say", text: "你好" }],
};

const STORY: Story = {
  formatVersion: 1,
  id: "demo",
  entry: "start",
  columns: [COLUMN],
};

/** 入口列的列文件（组装必需；本文件只关心清单侧） */
const COLUMN_DOC = {
  formatVersion: 1,
  id: "start",
  kind: "flow",
  commands: [{ op: "say", text: "你好" }],
};

const columnFiles = (): Map<string, unknown> =>
  new Map<string, unknown>([["Stories/start.json", COLUMN_DOC]]);

const manifestTextOf = (manifest: Record<string, unknown>): string => {
  const text = serializeProject(STORY, manifest).files.get(MANIFEST_FILE);
  if (text === undefined)
    throw new Error("serializeProject 未产出 project.json");
  return text;
};

const manifestOf = (
  manifest: Record<string, unknown>,
): Record<string, unknown> =>
  JSON.parse(manifestTextOf(manifest)) as Record<string, unknown>;

/** 组装器的 issues（形状校验失败的证据面） */
const issuesOf = (manifest: Record<string, unknown>): readonly string[] => {
  try {
    assembleProject(manifest, columnFiles());
  } catch (e) {
    if (e instanceof ProjectAssemblyError) return e.issues;
    throw e;
  }
  throw new Error("应当抛出 ProjectAssemblyError");
};

describe("清单 description · 形状校验", () => {
  it("字符串（含空串、超长文本、多行）一律接受", () => {
    const values = ["一句话简介", "", "长".repeat(300), "第一行\n第二行"];
    for (const description of values) {
      const story = assembleProject(
        { formatVersion: 1, id: "demo", entry: "start", description },
        columnFiles(),
      );
      expect(story.id).toBe("demo");
    }
  });

  it("非字符串 ⇒ 整次拒绝，issue 指出键名", () => {
    for (const description of [1, null, true, {}, ["简介"]]) {
      expect(
        issuesOf({ formatVersion: 1, id: "demo", entry: "start", description }),
      ).toEqual(["project.json: description 必须为字符串"]);
    }
  });

  it("缺席不校验（存量清单照常组装）", () => {
    const story = assembleProject(
      { formatVersion: 1, id: "demo", entry: "start" },
      columnFiles(),
    );
    expect(story.entry).toBe("start");
  });

  it("描述不是寻址依据：乱填内容不影响 id/entry 解析", () => {
    const story = assembleProject(
      {
        formatVersion: 1,
        id: "demo",
        entry: "start",
        description: "../别的工程",
      },
      columnFiles(),
    );
    expect(story.id).toBe("demo");
    expect(story.entry).toBe("start");
  });
});

describe("清单 description · 写出保留", () => {
  it("组装后写回：该键仍在，值原样，位置原位（非托管键不搬动）", () => {
    const manifest = {
      formatVersion: 1,
      id: "demo",
      entry: "start",
      name: "演示工程",
      description: "一个用来演示的工程",
      lang: "zh-CN",
    };
    const story = assembleProject(manifest, columnFiles());
    const text = manifestTextOf(manifest);
    expect(story.id).toBe("demo");
    expect(JSON.parse(text).description).toBe("一个用来演示的工程");
    // 托管键就地更新、非托管键原位：描述仍在 name 与 lang 之间
    expect(text.indexOf('"description"')).toBeGreaterThan(
      text.indexOf('"name"'),
    );
    expect(text.indexOf('"description"')).toBeLessThan(text.indexOf('"lang"'));
  });

  it("无描述 ⇒ 写回不新增该键（缺省产物逐字节不变的依据）", () => {
    const out = manifestOf({ formatVersion: 1, id: "demo", entry: "start" });
    expect("description" in out).toBe(false);
  });
});

describe("清单 description · 往返幂等", () => {
  it("serializeProject → 再 assembleProject → 再写出，description 不变且文本逐字节相同", () => {
    const manifest = {
      formatVersion: 1,
      id: "demo",
      entry: "start",
      description: "灵泛演示：一句话说清这部作品",
    };
    const first = manifestTextOf(manifest);
    const reread = JSON.parse(first) as Record<string, unknown>;
    const story = assembleProject(reread, columnFiles());
    expect(story.id).toBe("demo");
    // 组装器不回填描述进 Story：它是清单侧元信息，不在故事树上
    expect("description" in story).toBe(false);
    const second = manifestTextOf(reread);
    expect(JSON.parse(second).description).toBe("灵泛演示：一句话说清这部作品");
    expect(second).toBe(first);
  });
});

/**
 * 规约 10 声明制扩展装载测试（T08-06）。
 * 锚点: op-extension-scan
 *
 * 测试纪律：
 * - **声明制，非目录扫描制**：未声明 = 零副作用（装载器一次不触）；声明是唯一的装载依据
 * - **四链路旅程**：声明装载 → json 可用（引擎执行）→ dsl 往返（投影）→ 状态进存档（SSOT）
 *   → 读档校验（缺扩展整档拒绝 / 带扩展恢复）
 * - **装载期 fail-closed**：默认导出缺失 / id·stateVersion·ops 形状违约 / 模块缺失 /
 *   声明非字符串 → 抛错带 specifier 定位（组合根装配期 fail-fast）
 * - **清单校验**：project.json `extensions` 非法形态 → 组装拒绝；合法 → Story 透传
 *   （写回保真由 manifestText 非托管键原值保留保证）
 */
import { describe, expect, it, vi } from "vitest";
import type { OpExtension, Story } from "@lingfan/engine";
import {
  assembleProject,
  collectTextProjections,
  generateText,
  loadDeclaredExtensions,
  parseTextStory,
  ProjectAssemblyError,
  StoryEngine,
} from "@lingfan/engine";

/** demo 扩展（规约 10 §七 验收载体）：`say_command` 台词命令；执行计数随 SSOT（状态进存档链路） */
function demoCommandModule(): unknown {
  const extension: OpExtension = {
    id: "demo_command",
    stateVersion: 1,
    ops: [
      {
        op: "say_command",
        exec: (_cmd, ctx) => {
          const current =
            typeof ctx.get("count") === "number"
              ? (ctx.get("count") as number)
              : 0;
          ctx.set("count", current + 1);
          return { ok: true };
        },
        project: {
          toText: (cmd) => `say_command ${JSON.stringify(String(cmd.text ?? ""))}`,
          fromText: (text) => {
            const m = /^say_command\s+("((?:[^"\\]|\\.)*)")$/.exec(text);
            if (m === null) return null;
            return {
              op: "say_command",
              text: JSON.parse(m[1]!) as string,
            };
          },
        },
      },
    ],
  };
  return { default: extension };
}

const DEMO_SPECIFIER = "ext/demo-command.ts";
/** 宿主装载器替身：只认识声明的 demo 模块（其余 = 模块不存在——声明外不可达） */
const demoLoader = async (specifier: string): Promise<unknown> => {
  if (specifier === DEMO_SPECIFIER) return demoCommandModule();
  throw new Error("Cannot find module");
};

function storyWith(commands: object[]): Story {
  return {
    formatVersion: 1,
    id: "t",
    entry: "a",
    columns: [{ id: "a", kind: "flow", commands }],
  } as Story;
}

describe("T08-06 声明制扩展装载（锚点: op-extension-scan）", () => {
  it("未声明 = 零副作用：装载器一次不触（声明缺席与空数组同义）", async () => {
    const importModule = vi.fn(demoLoader);
    expect(await loadDeclaredExtensions(undefined, importModule)).toEqual([]);
    expect(await loadDeclaredExtensions([], importModule)).toEqual([]);
    expect(importModule).not.toHaveBeenCalled();
  });

  it("四链路旅程：声明装载 → json 可用 → dsl 往返 → 状态进存档 → 读档校验", async () => {
    const extensions = await loadDeclaredExtensions([DEMO_SPECIFIER], demoLoader);
    const story = storyWith([
      { op: "say", text: "一" },
      { op: "say_command", text: "自定义台词" },
      { op: "say", text: "二" },
    ]);

    // 链路①：json 可用——引擎执行扩展 op，状态经 ctx.set 进 SSOT
    const engine = new StoryEngine(story, { extensions });
    engine.start();
    engine.advance(); // say_command 执行 → ext.demo_command.count = 1 → 停在「二」
    expect(engine.get("ext.demo_command.count")).toBe(1);

    // 链路②：dsl 可投影——json → dsl → json 往返深等
    const projections = collectTextProjections(extensions);
    const text = generateText(story, projections);
    expect(text).toContain('say_command "自定义台词"');
    const reparsed = parseTextStory(text, "rt", projections);
    expect(reparsed.columns[0]?.commands).toEqual(story.columns[0]?.commands);

    // 链路③：状态进存档——SSOT 值 + 扩展依赖标记随档
    const data = engine.exportSave();
    expect(data).not.toBeNull();
    const savedCount = (data?.state as [string, unknown][]).find(
      ([k]) => k === "ext.demo_command.count",
    )?.[1];
    expect(savedCount).toBe(1);
    expect(data?.extensions).toEqual([{ id: "demo_command", stateVersion: 1 }]);
    engine.dispose();

    // 链路④：读档校验——缺扩展整档拒绝；带扩展恢复且状态一致
    const missing = new StoryEngine(story, { extensions: [] });
    expect(missing.importSave(JSON.parse(JSON.stringify(data)) as never)).toBe(
      false,
    );
    missing.dispose();
    const revived = new StoryEngine(story, { extensions });
    expect(revived.importSave(JSON.parse(JSON.stringify(data)) as never)).toBe(
      true,
    );
    expect(revived.get("ext.demo_command.count")).toBe(1);
    revived.dispose();
  });

  it("装载期 fail-closed：默认导出缺失 / id·stateVersion·ops 形状违约 / 模块缺失 / 声明非字符串，均带 specifier 定位", async () => {
    await expect(
      loadDeclaredExtensions(["ext/a.ts"], async () => ({ noDefault: true })),
    ).rejects.toThrow(/ext\/a\.ts.*默认导出/s);
    await expect(
      loadDeclaredExtensions(["ext/b.ts"], async () => ({
        default: { id: "Bad", stateVersion: 1 },
      })),
    ).rejects.toThrow(/ext\/b\.ts.*id 不合法/s);
    await expect(
      loadDeclaredExtensions(["ext/c.ts"], async () => ({
        default: { id: "ok", stateVersion: 0 },
      })),
    ).rejects.toThrow(/ext\/c\.ts.*stateVersion/s);
    await expect(
      loadDeclaredExtensions(["ext/d.ts"], async () => ({
        default: { id: "ok", stateVersion: 1, ops: [{ op: "x" }] },
      })),
    ).rejects.toThrow(/ext\/d\.ts.*ops 条目/s);
    await expect(
      loadDeclaredExtensions(["ext/missing.ts"], async () => {
        throw new Error("Cannot find module");
      }),
    ).rejects.toThrow(/ext\/missing\.ts.*模块装载失败/s);
    await expect(loadDeclaredExtensions([""], demoLoader)).rejects.toThrow(
      /扩展声明不合法/,
    );
  });

  it("清单声明校验：extensions 非法形态 → 组装拒绝；合法 → Story 透传", () => {
    const files = new Map<string, unknown>([
      ["Stories/start.json", { formatVersion: 1, id: "start", kind: "flow", commands: [] }],
    ]);
    const issuesOf = (manifest: unknown): string[] => {
      try {
        assembleProject(manifest, files);
      } catch (e) {
        if (e instanceof ProjectAssemblyError) return e.issues;
        throw e;
      }
      return [];
    };
    expect(issuesOf({ formatVersion: 1, id: "p", entry: "start", extensions: "demo" })).toEqual(
      [expect.stringContaining("extensions 必须为非空字符串数组")],
    );
    expect(
      issuesOf({ formatVersion: 1, id: "p", entry: "start", extensions: [42] }),
    ).toEqual([expect.stringContaining("extensions 必须为非空字符串数组")]);
    expect(
      issuesOf({ formatVersion: 1, id: "p", entry: "start", extensions: [""] }),
    ).toEqual([expect.stringContaining("extensions 必须为非空字符串数组")]);

    const story = assembleProject(
      {
        formatVersion: 1,
        id: "p",
        entry: "start",
        extensions: [DEMO_SPECIFIER],
      },
      files,
    );
    expect(story.extensions).toEqual([DEMO_SPECIFIER]); // 透传给组合根
    const silent = assembleProject(
      { formatVersion: 1, id: "p", entry: "start" },
      files,
    );
    expect(silent.extensions).toBeUndefined(); // 缺席 = 无扩展（零副作用）
  });
});

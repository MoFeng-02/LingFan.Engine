/**
 * 场景类型收两值的**归一与边界**判据。
 *
 * 契约只承认 `game` / `ui` 两个取值，因为它们对应**唯一一件运行期事实**：
 * 进不进历史与存档。菜单与弹窗在引擎里从来没有行为差异，所以不拆成三值；
 * 界面内部怎么分类（标题页 / 设置页 / 弹窗）归页面层表达，不进运行语义类型。
 *
 * 本文件的四组断言各守一侧：
 * ① 读入：缺省 = game；非法值 fail-closed（不静默当 game——那种错要等存档/回溯
 *    出问题才发现，代价极高）。
 * ② 读出：序列化与文本投影写出的恒是契约值，非缺省才写。
 * ③ DSL：`scene <id> type=ui` 解析进契约；无法识别的 `type=xxx` 走告警而非静默。
 * ④ 单一判定点：可回溯判定只经 `isReplayableColumn`，缺省按 game。
 */
import { describe, expect, it } from "vitest";
import {
  isReplayableColumn,
  isSceneType,
  normalizeSceneType,
  parseStory,
  parseTextStory,
  projectText,
  sceneTypeOf,
  serializeColumnDocument,
  StoryFormatError,
} from "@lingfan-engine/core";

/** 单列故事的最小外壳（`entry` 指向该列） */
function storyOf(column: Record<string, unknown>): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: "demo",
    entry: String(column.id),
    columns: [column],
  };
}

describe("场景类型 · 读入归一", () => {
  it("缺省 = game（不写 type 与显式写 game 同值）", () => {
    const implicit = parseStory(
      storyOf({ id: "a", kind: "flow", commands: [] }),
    );
    const explicit = parseStory(
      storyOf({ id: "a", kind: "flow", type: "game", commands: [] }),
    );
    expect(implicit.columns[0]?.type).toBeUndefined();
    expect(explicit.columns[0]?.type).toBe("game");
    expect(sceneTypeOf(implicit.columns[0]!)).toBe("game");
    expect(sceneTypeOf(explicit.columns[0]!)).toBe("game");
  });

  it("`ui` 读入即契约值（不还原成别的拼写）", () => {
    const story = parseStory(
      storyOf({ id: "a", kind: "flow", type: "ui", commands: [] }),
    );
    expect(story.columns[0]?.type).toBe("ui");
    expect(sceneTypeOf(story.columns[0]!)).toBe("ui");
  });

  it("**非法 type fail-closed**（含已废弃的第三种拼写）", () => {
    // 不静默当 game：作者以为设了界面层、其实是剧情，那错要等存档/回溯才暴露
    for (const bad of ["menu", "Menu", "UI", "scene", 1, null, {}]) {
      expect(() =>
        parseStory(storyOf({ id: "a", kind: "flow", type: bad, commands: [] })),
      ).toThrow(StoryFormatError);
    }
  });

  it("错误文案点名两个合法取值（作者照着改得动）", () => {
    let message = "";
    try {
      parseStory(
        storyOf({ id: "a", kind: "flow", type: "menu", commands: [] }),
      );
    } catch (error: unknown) {
      message = String((error as Error).message);
    }
    expect(message).toContain('"game"');
    expect(message).toContain('"ui"');
    expect(message).toContain("menu");
  });
});

describe("场景类型 · 判定函数", () => {
  it("`isSceneType` 只认契约两值", () => {
    expect(isSceneType("game")).toBe(true);
    expect(isSceneType("ui")).toBe(true);
    for (const bad of ["menu", "Game", "UI", "", undefined, null, 0, {}]) {
      expect(isSceneType(bad)).toBe(false);
    }
  });

  it("`normalizeSceneType` 把缺省与非法值都收敛到 game", () => {
    expect(normalizeSceneType("ui")).toBe("ui");
    expect(normalizeSceneType("game")).toBe("game");
    expect(normalizeSceneType(undefined)).toBe("game");
    expect(normalizeSceneType("menu")).toBe("game");
    expect(normalizeSceneType(3)).toBe("game");
  });

  it("`isReplayableColumn` 与 `sceneTypeOf` 同口径（单一判定点）", () => {
    expect(isReplayableColumn({ type: "ui" })).toBe(false);
    expect(isReplayableColumn({ type: "game" })).toBe(true);
    expect(isReplayableColumn({})).toBe(true); // 缺省 = game
    expect(isReplayableColumn({ type: "menu" as never })).toBe(true); // 非法值按缺省
  });
});

describe("场景类型 · 写出恒契约值", () => {
  it("序列化：`game` 不写字段、`ui` 写出契约值", () => {
    const doc = (column: Record<string, unknown>): Record<string, unknown> =>
      JSON.parse(
        serializeColumnDocument(
          parseStory(
            { formatVersion: 1, id: String(column.id), ...column },
            `${String(column.id)}.json`,
          ),
          String(column.id),
        ).files.get(`Stories/${String(column.id)}.json`) ?? "{}",
      ) as Record<string, unknown>;

    const game = doc({ id: "a", kind: "flow", commands: [] }) as {
      type?: unknown;
    };
    expect("type" in game).toBe(false);

    const ui = doc({ id: "b", kind: "flow", type: "ui", commands: [] }) as {
      type?: unknown;
    };
    expect(ui.type).toBe("ui");
  });

  it("文本投影：`game` 不写 `type=`、`ui` 写 `type=ui`", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "demo",
      entry: "play",
      columns: [
        { id: "play", kind: "scene", elements: [], entry: [] },
        { id: "title", kind: "scene", type: "ui", elements: [], entry: [] },
      ],
    });
    const { text, issues } = projectText(story);
    expect(issues).toEqual([]);
    expect(text).toContain("scene play\n");
    expect(text).not.toContain("scene play type=");
    expect(text).toContain("scene title type=ui");
  });
});

describe("场景类型 · DSL 解析", () => {
  it("`scene <id> type=ui` 解析进契约", () => {
    const story = parseTextStory(
      'scene title type=ui\n  say "标题"\n',
      "t.story",
    );
    expect(story.columns[0]?.type).toBe("ui");
    expect(isReplayableColumn(story.columns[0]!)).toBe(false);
  });

  it("`scene <id>` 缺省 = game", () => {
    const story = parseTextStory('scene play\n  say "剧情"\n', "p.story");
    expect(story.columns[0]?.type).toBeUndefined();
    expect(isReplayableColumn(story.columns[0]!)).toBe(true);
  });

  it("**无法识别的 `type=` fail-closed**（不静默当 game）", () => {
    // 早先的第三种拼写已废弃：解析不认它，也不把它当剧情悄悄吃掉——
    // 作者的意图被改写而不被告知，比直接报错危险得多。
    let message = "";
    try {
      parseTextStory('scene title type=menu\n  say "标题"\n', "t.story");
    } catch (error: unknown) {
      message = String((error as Error).message);
    }
    expect(message).toContain("type=menu");
    expect(message).toContain("无法识别的参数");
  });

  it("文本往返：`type=ui` 投影回去仍是 `type=ui`（不漂移）", () => {
    const story = parseTextStory(
      'scene title type=ui\n  say "标题"\n',
      "t.story",
    );
    const { text, issues } = projectText(story);
    expect(issues).toEqual([]);
    expect(text).toContain("scene title type=ui");
    const again = parseTextStory(text, "t.story");
    expect(again.columns[0]?.type).toBe("ui");
  });
});

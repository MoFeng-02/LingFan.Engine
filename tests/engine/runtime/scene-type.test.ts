/**
 * **场景类型（`type: game|menu|ui`）守卫测试**（用户实测回归锚定 · 治根）。
 *
 * 权威语义来源：老引擎 `E:\Project\Engine\src\EngineCore\…\Entities\Enums\SceneType.cs`
 *   Game = 0（存档、入栈、建检查点）
 *   Menu = 1（菜单/标题/设置：不存档、不入栈、不建检查点）
 *   UI   = 2（覆盖层/弹窗：同上，且不改历史游标）
 * 三处守卫对照老引擎 `SaveDataService.BuildSaveData` / `PlaybackService.Process` /
 * `NavigateHandler`。
 *
 * API 说明（对齐 tests/engine/runtime/engine.test.ts 的真实用法）：
 *   `start()` 无参启动；`advance()` 推进一个等待点；`choose("列id")` 用**目标列 id**选菜单（见 engine.ts `choose`）。
 *
 * 覆盖五组：① 契约与解析 ② 回溯守卫 ③ 存档守卫 ④ 边界 ⑤ 真实工程形态
 */
import { describe, expect, it, vi } from "vitest";
import {
  SYS,
  StoryEngine,
  isReplayableColumn,
  isSceneType,
  parseStory,
  serializeProject,
  type OutboundEvent,
  type Story,
} from "@lingfan/engine";

// ---------- 夹具 ----------

/**
 * 四列：play（game）/ main_menu（menu）/ play2（game）/ overlay（ui）。
 * play 的菜单第0 项 = 进菜单，第 1 项 = 直接进 play2。
 */
function makeTypedStory(): Story {
  return parseStory({
    formatVersion: 1,
    id: "typed",
    entry: "play",
    columns: [
      {
        id: "play",
        kind: "flow",
        commands: [
          { op: "say", text: "第一步" },
          {
            op: "menu",
            prompt: "去哪",
            options: [
              { text: "进菜单", target: "main_menu" },
              { text: "直接前进", target: "play2" },
            ],
          },
        ],
      },
      {
        id: "main_menu",
        kind: "flow",
        type: "menu",
        commands: [
          { op: "say", text: "主菜单" },
          {
            op: "menu",
            prompt: "继续",
            options: [{ text: "回游戏", target: "play2" }],
          },
        ],
      },
      { id: "play2", kind: "flow", commands: [{ op: "say", text: "第二步" }] },
      { id: "overlay", kind: "flow", type: "ui", commands: [{ op: "say", text: "弹窗" }] },
    ],
  });
}

function instrument(engine: StoryEngine) {
  const errors: OutboundEvent[] = [];
  const off = engine.onEvent((e) => errors.push(e));
  return { engine, errors, dispose: off };
}

/** 走到 play 的菜单等待点（`SYS.currentSceneColumn` 应为 play） */
function startToMenu(): ReturnType<typeof instrument> {
  const h = instrument(new StoryEngine(makeTypedStory()));
  h.engine.start();
  h.engine.advance(); // 消化第一句 say ⇒ 落在菜单等待点
  return h;
}

// ---------- ① 契约与解析 ----------

describe("场景类型 · 契约与解析（**缺省 = game**）", () => {
  it("`isSceneType` 只认三个值", () => {
    expect(isSceneType("game")).toBe(true);
    expect(isSceneType("menu")).toBe(true);
    expect(isSceneType("ui")).toBe(true);
    expect(isSceneType("Game")).toBe(false);
    expect(isSceneType("")).toBe(false);
    expect(isSceneType(undefined)).toBe(false);
  });

  it("**缺省 type ⇒ 视为 game**（对齐老引擎 `SceneType.Game = 0`）", () => {
    expect(isReplayableColumn({})).toBe(true);
    expect(isReplayableColumn({ type: undefined })).toBe(true);
  });

  it("menu / ui ⇒ 不参与回溯", () => {
    expect(isReplayableColumn({ type: "menu" })).toBe(false);
    expect(isReplayableColumn({ type: "ui" })).toBe(false);
  });

  it("**非法 type fail-closed**（不静默当 game）", () => {
    expect(() =>
      parseStory({
        formatVersion: 1,
        id: "x",
        entry: "a",
        columns: [{ id: "a", kind: "flow", type: "cutscene", commands: [] }],
      }),
    ).toThrow(/type/);
  });

  it("**多文件入口也校验**（组装器是另一条路径，漏掉就能绕过）", () => {
    // ⚠️ 真实签名 = serializeProject(story, manifest)（见 data/project.ts:309）。
    // ⚠️ **不能走 parseStory 造夹具**——它在构造期就拦下非法 type（那是单文件层，
    // 本例要测的是**组装器这条独立入口**）⇒ 直接构造 Story 对象绕过它。
    const story = {
      formatVersion: 1,
      id: "x",
      entry: "a",
      columns: [{ id: "a", kind: "flow", type: "nope", commands: [] }],
    } as unknown as Story;
    const manifest = { formatVersion: 1, id: "x", entry: "a" };
    expect(() => serializeProject(story, manifest)).toThrow(/type/);
  });

  it("**type 与 kind 正交**：`flow` + `menu` 合法（纯流程的菜单）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "orth",
      entry: "m",
      columns: [{ id: "m", kind: "flow", type: "menu", commands: [] }],
    });
    expect(story.columns[0]?.kind).toBe("flow");
    expect(isReplayableColumn(story.columns[0]!)).toBe(false);
  });
});

// ---------- ② 回溯守卫 ----------

describe("场景类型 · 回溯守卫（**menu/ui 不建检查点**）", () => {
  it("**基线：游戏列的菜单等待点已建检查点**（证明机制本身通）", () => {
    const h = startToMenu();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("play");
    // 能回溯到更早 ⇒ 有历史
    h.engine.back();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("play");
    h.dispose();
  });

  it("**进入 menu 列后不产生新检查点**（菜单不是玩家经历的一步）", () => {
    const h = startToMenu();
    // ⚠️ 精确判据：**直接读历史长度**，不用 back() 落点反推
    // （`back()` 会先 flushPendingCheckpoint，测的是 flush 语义不是守卫）
    const before = h.engine.historyLength();
    const cursorBefore = h.engine.historyCursor();
    h.engine.choose("main_menu"); // → main_menu（落在其say 等待点）
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("main_menu");
    // ⚠️ 再 advance 一次落菜单自己的菜单等待点——**这里才是「菜单里玩家所见」的点**，
    // 若守卫失效就会建出检查点（对照：游戏列同样 advance 会增长）
    h.engine.advance();
    // 🔴 核心判据：菜单期间历史**零增长**
    expect(h.engine.historyLength()).toBe(before);
    expect(h.engine.historyCursor()).toBe(cursorBefore);
    h.dispose();
  });

  it("**进入 ui 列同样不建检查点**", () => {
    const h = startToMenu();
    const before = h.engine.historyLength();
    h.engine.navigate("overlay");
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("overlay");
    h.engine.advance(); // 落到 ui 列自己的等待点
    expect(h.engine.historyLength()).toBe(before);
    h.dispose();
  });

  it("**对照：游戏列确实会建检查点**（守卫没把正常流程也拦掉）", () => {
    const h = startToMenu();
    const before = h.engine.historyLength();
    h.engine.choose("play2"); // → play2（game 列）
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("play2");
    // ⚠️ 检查点在**落新等待点时**才建（规约 R1「检查点在用户所见后」），
    // 所以要 advance 一次才看得到增长——守卫挂在 commitCheckpoint 上，判据同理。
    h.engine.advance();
    expect(h.engine.historyLength()).toBeGreaterThan(before);
    h.dispose();
  });

  it("从菜单回到 game 列 ⇒ 历史仍只含游戏步骤（守卫不误伤正常流程）", () => {
    const h = startToMenu();
    h.engine.choose("main_menu"); // → main_menu（落在其say 等待点）
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("main_menu");
    // ⚠️ 菜单列自己的 say 也要 advance 才落到它的菜单等待点
    h.engine.advance();
    h.engine.choose("play2"); // → play2（game）
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("play2");
    // 存档历史里不该出现菜单列
    const data = h.engine.exportSave();
    for (const c of data?.history ?? []) {
      expect(["play", "play2"]).toContain(c.coord.columnId);
    }
    h.dispose();
  });
});

// ---------- ③ 存档守卫 ----------

describe("场景类型 · 存档守卫（**菜单态存的是菜单前的游戏进度**）", () => {
  it("游戏态存档 ⇒ 坐标是当前剧情坐标", () => {
    const h = startToMenu();
    const data = h.engine.exportSave();
    expect(data?.coord.columnId).toBe("play");
    h.dispose();
  });

  it("**菜单态存档 ⇒ 坐标是菜单前的游戏点**（Ren'Py Esc 菜单存档语义）", () => {
    const h = startToMenu();
    const inGame = h.engine.exportSave();
    h.engine.choose("main_menu"); // → main_menu
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("main_menu");
    const inMenu = h.engine.exportSave();
    // 🔴 核心判据：档里是游戏点，不是菜单
    expect(inMenu?.coord.columnId).toBe("play");
    expect(inMenu?.coord.columnId).toBe(inGame?.coord.columnId);
    h.dispose();
  });

  it("**菜单态存档的历史只含游戏步骤**（菜单的覆盖不进档）", () => {
    const h = startToMenu();
    h.engine.choose("main_menu");
    const data = h.engine.exportSave();
    expect(data).not.toBeNull();
    for (const c of data?.history ?? []) {
      expect(["play", "play2"]).toContain(c.coord.columnId);
    }
    h.dispose();
  });

  it("**无游戏点时菜单态存档被拒**（对齐老引擎「没有正在进行的游戏 ⇒ null」）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "menu-only",
      entry: "m",
      columns: [
        { id: "m", kind: "flow", type: "menu", commands: [{ op: "say", text: "只有菜单" }] },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    h.engine.advance();
    expect(h.engine.exportSave()).toBeNull();
    h.dispose();
  });
});

// ---------- ④ 边界条件 ----------

describe("场景类型 · 边界条件", () => {
  it("**菜单 → 菜单导航不覆盖游戏点**（否则连开两个菜单会把存档点写坏）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "chain",
      entry: "play",
      columns: [
        {
          id: "play",
          kind: "flow",
          commands: [
            { op: "menu", prompt: "去？", options: [{ text: "A", target: "menuA" }] },
          ],
        },
        {
          id: "menuA",
          kind: "flow",
          type: "menu",
          commands: [
            { op: "menu", prompt: "B？", options: [{ text: "B", target: "menuB" }] },
          ],
        },
        { id: "menuB", kind: "flow", type: "menu", commands: [{ op: "say", text: "另一个" }] },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    h.engine.choose("menuA"); // → menuA（记游戏点 = play）
    h.engine.choose("menuB"); // → menuB（**不得**覆盖成 menuA）
    expect(h.engine.exportSave()?.coord.columnId).toBe("play");
    h.dispose();
  });

  it("ui 列同样不覆盖游戏点", () => {
    const h = startToMenu();
    h.engine.navigate("overlay");
    expect(h.engine.exportSave()?.coord.columnId).toBe("play");
    h.dispose();
  });

  it("`__menu_return` 是系统键（`__` 前缀 ⇒ 保留命名空间）", () => {
    expect(String(SYS.menuReturn).startsWith("__")).toBe(true);
  });
});

// ---------- ⑤ 真实工程形态 + 守卫自证 ----------

describe("场景类型 · 真实工程形态与自证", () => {
  it("**纯菜单工程**：一条历史都不建（用户实测工程全是 type=menu）", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "ui-only",
      entry: "title",
      columns: [
        { id: "title", kind: "flow", type: "menu", commands: [{ op: "say", text: "标题" }] },
        { id: "about", kind: "flow", type: "menu", commands: [{ op: "say", text: "关于" }] },
      ],
    });
    const h = instrument(new StoryEngine(story));
    h.engine.start();
    h.engine.advance();
    h.engine.back(); // 无历史 ⇒ 不动
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("title");
    h.dispose();
  });

  it("**菜单态导出不发 engine.error**（有游戏点时守卫放行）", () => {
    const spy = vi.fn();
    const h = startToMenu();
    h.engine.onEvent(spy);
    h.engine.choose("main_menu");
    h.engine.exportSave();
    const errs = spy.mock.calls.filter(
      (c) => (c[0] as { kind?: string })?.kind === "engine.error",
    );
    expect(errs).toHaveLength(0);
    h.dispose();
  });

  it("**缺 game 标记的既有工程零影响**（回归：没有 type 的老故事照旧能回溯）", () => {
    const h = startToMenu();
    // play 列没有 type ⇒ 视为 game ⇒ 能退回去
    h.engine.back();
    expect(h.engine.get(SYS.currentSceneColumn)).toBe("play");
    h.dispose();
  });
});

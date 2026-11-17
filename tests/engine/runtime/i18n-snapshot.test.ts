/**
 * 快照/存档语言解耦（存原文）与老存档降级。
 * - 快照与存档存原文 + 源：读档/回溯按当前语言派生显示
 * - SaveDataV1 字段集合不变（值语义变化不加字段）
 * - 老存档（无 i18nSources、表面是译文成品）：疑似译文内存标记跳过查表，
 *   译文恰等于另一键原文也不误译；切语言保持原样；键被引擎重写后恢复正常派生
 * I18nPort 为契约替身；老档由新档手工退化构造（删源键 + 表面值替换为译文成品）。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile, SaveDataV1 } from "@lingfan-engine/core";
import {
  SYS,
  StoryEngine,
  createStateReader,
  parseStory,
} from "@lingfan-engine/core";

/** I18nPort 契约替身：内存译文表 */
class MemoryI18nPort {
  private readonly tables = new Map<string, Record<string, string>>();

  table(lang: string, entries: Record<string, string>): this {
    this.tables.set(lang, entries);
    return this;
  }

  async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    return [{ path: "main.json", entries: this.tables.get(lang) ?? {} }];
  }
}

/** NVL + 场景元素 + 菜单等待的故事：存档坐标落在菜单（重放只重建菜单表面） */
const STORY = {
  formatVersion: 1,
  id: "t",
  entry: "a",
  columns: [
    {
      id: "a",
      kind: "scene",
      elements: [{ type: "text", id: "t1", text: "第二幕" }],
      entry: [
        { op: "nvl" },
        { op: "say", text: "第一段" },
        { op: "say", text: "第二段" },
        {
          op: "menu",
          prompt: "选择",
          options: [{ text: "攻击", target: "b" }],
        },
      ],
    },
    { id: "b", kind: "flow", commands: [{ op: "say", text: "新段" }] },
  ],
};

function makeEngine(port?: MemoryI18nPort): StoryEngine {
  return new StoryEngine(parseStory(STORY), port ? { i18nPort: port } : {});
}

/** 走到菜单等待画面（NVL 两行 + 场景元素已在状态里） */
function toMenuWaiting(engine: StoryEngine): void {
  engine.start();
  engine.advance();
  engine.advance();
}

/** 新档退化为老档：删源键，NVL/元素/菜单表面替换为译文成品 */
function degradeToLegacy(save: SaveDataV1): SaveDataV1 {
  const state = save.state
    .filter(([key]) => key !== SYS.i18nSources)
    .map(([key, value]): [string, unknown] => {
      if (key === SYS.nvlBuffer) return [key, ["One", "Two"]];
      if (key === SYS.menuPrompt) return [key, "Choose"];
      if (key === SYS.menuOptions) return [key, ["Attack"]];
      if (key === SYS.elements) {
        const list = value as Array<{ props: Record<string, unknown> }>;
        return [
          key,
          list.map((item) => ({
            ...item,
            props: { ...item.props, text: "Act 2" },
          })),
        ];
      }
      return [key, value];
    });
  return { ...save, state };
}

describe("快照与存档存原文", () => {
  it("存档状态存原文 + 源；字段集合不变", async () => {
    const port = new MemoryI18nPort().table("en", {
      第一段: "One",
      第二段: "Two",
      选择: "Choose",
      攻击: "Attack",
    });
    const engine = makeEngine(port);
    await engine.setLanguage("en");
    toMenuWaiting(engine);
    const save = engine.exportSave()!;
    const stateOf = (key: string) => save.state.find(([k]) => k === key)?.[1];
    expect(stateOf(SYS.nvlBuffer)).toEqual(["第一段", "第二段"]);
    expect(stateOf(SYS.menuOptions)).toEqual(["攻击"]);
    expect(stateOf(SYS.i18nSources)).toBeDefined();
    // 字段集合不变：i18n 只改值语义，不新增存档字段
    const known = new Set([
      "formatVersion",
      "storyId",
      "title",
      "coord",
      "state",
      "scope",
      "rngState",
      "functions",
      "cursor",
      "screenshot",
      "extensions",
      "storyVersion",
      "deleted",
      "minigames",
      "history",
    ]);
    expect(Object.keys(save).filter((k) => !known.has(k))).toEqual([]);
    engine.dispose();
  });

  it("读档按当前语言派生：原文存档在 ja 引擎里显示 ja", async () => {
    const enPort = new MemoryI18nPort().table("en", {
      第一段: "One",
      第二段: "Two",
      选择: "Choose",
      攻击: "Attack",
    });
    const source = makeEngine(enPort);
    await source.setLanguage("en");
    toMenuWaiting(source);
    const save = JSON.parse(JSON.stringify(source.exportSave()!)) as SaveDataV1;
    source.dispose();

    const jaPort = new MemoryI18nPort().table("ja", {
      第一段: "一",
      第二段: "二",
      选择: "選ぶ",
      攻击: "攻撃",
    });
    const target = makeEngine(jaPort);
    await target.setLanguage("ja");
    target.start();
    expect(target.importSave(save)).toBe(true);
    const reader = createStateReader(target);
    expect(reader.menuPrompt()).toBe("選ぶ");
    expect(reader.menuChoices()).toEqual([{ text: "攻撃", target: "b" }]);
    expect(reader.nvlLines()).toEqual(["一", "二"]);
    target.dispose();
  });

  it("回溯按当前语言派生：快照原文恢复后经读口重译", async () => {
    const port = new MemoryI18nPort().table("en", { 甲: "A", 乙: "B" });
    const engine = new StoryEngine(
      parseStory({
        formatVersion: 1,
        id: "t",
        entry: "a",
        columns: [
          {
            id: "a",
            kind: "flow",
            commands: [
              { op: "say", text: "甲" },
              { op: "say", text: "乙" },
            ],
          },
        ],
      }),
      { i18nPort: port },
    );
    engine.start();
    engine.advance(); // 检查点：甲画面
    await engine.setLanguage("en");
    expect(engine.get(SYS.currentDialogText)).toBe("B");
    engine.rollbackTo(0);
    expect(engine.get(SYS.currentDialogText)).toBe("A");
    engine.dispose();
  });
});

describe("老存档降级：疑似译文标记", () => {
  // 冲突表：老档译文成品恰好也是另一些键的原文——标记必须挡住查表防误译
  const CONFLICT = {
    第一段: "One",
    One: "UNO",
    第二段: "Two",
    Two: "DEUX",
    第二幕: "Act 2",
    "Act 2": "ACTE",
    选择: "Choose",
    Choose: "Choix",
    攻击: "Attack",
    Attack: "Attaque",
  };

  async function legacyEngine(): Promise<StoryEngine> {
    const saver = makeEngine();
    toMenuWaiting(saver);
    const legacy = degradeToLegacy(saver.exportSave()!);
    saver.dispose();
    const engine = makeEngine(new MemoryI18nPort().table("en", CONFLICT));
    await engine.setLanguage("en");
    engine.start();
    expect(engine.importSave(legacy)).toBe(true);
    return engine;
  }

  it("老档译文成品直出不误译；重放重建的表面正常派生", async () => {
    const engine = await legacyEngine();
    const reader = createStateReader(engine);
    // NVL/元素由快照恢复不重放 → 标记跳过查表（One≠UNO、Act 2≠ACTE）
    expect(reader.nvlLines()).toEqual(["One", "Two"]);
    const elements = engine.get(SYS.elements) as Array<{
      props: Record<string, unknown>;
    }>;
    expect(elements[0].props.text).toBe("Act 2");
    // 菜单是等待 op，重放已写原文 + 源 → 正常派生（Choose≠Choix）
    expect(reader.menuPrompt()).toBe("Choose");
    expect(reader.menuChoices()).toEqual([{ text: "Attack", target: "b" }]);
    engine.dispose();
  });

  it("老档切语言：无源表面保持原样，有源表面按新语言派生", async () => {
    const port = new MemoryI18nPort().table("en", CONFLICT).table("fr", {
      第一段: "Un",
      第二段: "Deux",
      选择: "Choisir",
      攻击: "Attaquer",
    });
    const saver = makeEngine();
    toMenuWaiting(saver);
    const legacy = degradeToLegacy(saver.exportSave()!);
    saver.dispose();
    const engine = makeEngine(port);
    await engine.setLanguage("en");
    engine.start();
    expect(engine.importSave(legacy)).toBe(true);
    await engine.setLanguage("fr");
    const reader = createStateReader(engine);
    expect(reader.nvlLines()).toEqual(["One", "Two"]); // 标记仍在，保持原样
    const elements = engine.get(SYS.elements) as Array<{
      props: Record<string, unknown>;
    }>;
    expect(elements[0].props.text).toBe("Act 2");
    expect(reader.menuPrompt()).toBe("Choisir"); // 重放重建的表面按 fr 派生
    expect(reader.menuChoices()).toEqual([{ text: "Attaquer", target: "b" }]);
    engine.dispose();
  });

  it("键被引擎重写后标记清除：新行正常翻译，旧行未命中回退原样", async () => {
    const port = new MemoryI18nPort().table("en", {
      第一段: "One",
      第二段: "Two",
      选择: "Choose",
      攻击: "Attack",
      新段: "New",
    });
    const engine = makeEngine(port);
    await engine.setLanguage("en");
    engine.start();
    const saver = makeEngine();
    toMenuWaiting(saver);
    const legacy = degradeToLegacy(saver.exportSave()!);
    saver.dispose();
    expect(engine.importSave(legacy)).toBe(true);
    expect(createStateReader(engine).nvlLines()).toEqual(["One", "Two"]);
    engine.choose("b"); // say 新段：NVL 追加重写 buffer → 标记清除
    // 旧译文行不在表里 → 回退原样；新原文行正常翻译
    expect(createStateReader(engine).nvlLines()).toEqual(["One", "Two", "New"]);
    engine.dispose();
  });
});

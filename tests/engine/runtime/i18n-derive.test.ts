/**
 * 运行期派生与即时生效（状态存原文 / 三处同源 / 性能护栏）。
 * - 状态 Map 存原文 + 插值源；译文只在派生读口产生
 * - 出站事件 / engine.get / StateReader 三处对派生键给同一译文
 * - L8 互锁：状态原文经派生 == 旧语义（同一查表函数先译后插值）的译文
 * - 元素内部寻址读原始态，宿主渲染经读口拿译文
 * - 护栏：未切语言读不查表（缓存命中）、切语言成本≈可见表面、合并只在供给时、
 *   状态无 *_translated 旁键、切语言帧栈不动
 * I18nPort 为契约替身；overlay 查表计数经白盒包装（只读观测，不改语义）。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan-engine/core";
import {
  SYS,
  StoryEngine,
  createStateReader,
  parseStory,
} from "@lingfan-engine/core";

/** I18nPort 契约替身：内存译文表 + 调用记录 */
class MemoryI18nPort {
  readonly calls: string[] = [];
  private readonly tables = new Map<string, Record<string, string>>();

  table(lang: string, entries: Record<string, string>): this {
    this.tables.set(lang, entries);
    return this;
  }

  async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    this.calls.push(lang);
    return [{ path: "main.json", entries: this.tables.get(lang) ?? {} }];
  }
}

function makeHarness(
  columns: object[],
  port?: MemoryI18nPort,
  entry = "a",
  defines?: Record<string, unknown>,
) {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      entry,
      columns,
      ...(defines !== undefined ? { defines } : {}),
    }),
    port ? { i18nPort: port } : {},
  );
  const errors: string[] = [];
  const off = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
  });
  return {
    engine,
    port: port ?? new MemoryI18nPort(),
    errors,
    dispose: () => {
      off();
      engine.dispose();
    },
  };
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

/**
 * 白盒观测：包装 overlay 的 get 计数查表次数（缓存命中时不查表）。
 * 切语言整表重建会换 Map 引用——拦截 overlay 赋值，新表同样被计数。
 */
function countLookups(engine: StoryEngine): () => number {
  const holder = engine as unknown as {
    overlay: Map<string, string> | null;
  };
  let n = 0;
  const wrap = (table: Map<string, string> | null): void => {
    if (table === null) return;
    const original = table.get.bind(table);
    table.get = (key: string) => {
      n += 1;
      return original(key);
    };
  };
  let current = holder.overlay;
  wrap(current);
  Object.defineProperty(engine, "overlay", {
    configurable: true,
    get: () => current,
    set: (next: Map<string, string> | null) => {
      current = next;
      wrap(next);
    },
  });
  return () => n;
}

/** 存档状态里取某键的原始值（exportSave 读原始态，不经派生） */
function savedState(engine: StoryEngine, key: string): unknown {
  const save = engine.exportSave();
  expect(save).not.toBeNull();
  return save!.state.find(([k]) => k === key)?.[1];
}

describe("状态存原文 + 源捕获", () => {
  it("say：状态存原文与源，读口给译文", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness([column("a", [{ op: "say", text: "你好" }])], port);
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(savedState(h.engine, SYS.currentDialogText)).toBe("你好");
    const sources = savedState(h.engine, SYS.i18nSources) as {
      dialog?: { key: string };
    };
    expect(sources.dialog?.key).toBe("你好");
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.dispose();
  });

  it("插值源捕获说话那一刻的实参；切语言用捕获值重插值", async () => {
    const port = new MemoryI18nPort().table("en", {
      "你好 {name}": "Hello {name}",
    });
    const h = makeHarness(
      [column("a", [{ op: "say", text: "你好 {name}" }])],
      port,
      "a",
      { name: "世界" },
    );
    h.engine.start();
    expect(savedState(h.engine, SYS.currentDialogText)).toBe("你好 世界");
    const sources = savedState(h.engine, SYS.i18nSources) as {
      dialog?: { key: string; values?: Record<string, unknown> };
    };
    expect(sources.dialog).toEqual({
      key: "你好 {name}",
      values: { name: "世界" },
    });
    await h.engine.setLanguage("en");
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello 世界");
    h.dispose();
  });

  it("speaker 存原文；menu/input 存原文，候选 value 不翻译", async () => {
    const port = new MemoryI18nPort().table("en", {
      灵泛: "LingFan",
      选择: "Choose",
      攻击: "Attack",
      输入: "Input",
      是: "Yes",
    });
    const h = makeHarness(
      [
        column("a", [
          { op: "say", text: "你好", speaker: "灵泛" },
          {
            op: "menu",
            prompt: "选择",
            options: [{ text: "攻击", target: "b" }],
          },
        ]),
        column("b", [
          {
            op: "input",
            prompt: "输入",
            store: "answer",
            options: [{ text: "是", value: "yes" }],
          },
        ]),
      ],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(savedState(h.engine, SYS.currentDialogSpeaker)).toBe("灵泛");
    expect(h.engine.get(SYS.currentDialogSpeaker)).toBe("LingFan");
    h.engine.advance(); // 菜单上屏
    expect(savedState(h.engine, SYS.menuOptions)).toEqual(["攻击"]);
    expect(savedState(h.engine, SYS.menuTargets)).toEqual(["b"]);
    expect(h.engine.get(SYS.menuPrompt)).toBe("Choose");
    h.engine.choose("b"); // 输入上屏
    expect(savedState(h.engine, SYS.inputOptions)).toEqual([
      { text: "是", value: "yes" },
    ]);
    const reader = createStateReader(h.engine);
    expect(reader.inputCandidates()).toEqual([{ text: "Yes", value: "yes" }]);
    h.dispose();
  });
});

describe("L8 互锁：状态原文经派生 == 旧语义译文", () => {
  it("对话/菜单/输入各表面与同一查表函数的先译后插值结果一致", async () => {
    const port = new MemoryI18nPort().table("en", {
      "你好 {name}": "Hello {name}",
      选择: "Choose",
      攻击: "Attack",
    });
    const h = makeHarness(
      [
        column("a", [
          { op: "say", text: "你好 {name}" },
          {
            op: "menu",
            prompt: "选择",
            options: [{ text: "攻击", target: "b" }],
          },
        ]),
        column("b", [{ op: "say", text: "结束" }]),
      ],
      port,
      "a",
      { name: "世界" },
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    // 旧语义参照：同一查表函数先译后插值（translate 读口）
    expect(h.engine.get(SYS.currentDialogText)).toBe(
      h.engine.interpolate(h.engine.translate("你好 {name}")),
    );
    h.engine.advance();
    expect(h.engine.get(SYS.menuPrompt)).toBe(h.engine.translate("选择"));
    expect(h.engine.get(SYS.menuOptions)).toEqual([h.engine.translate("攻击")]);
    h.dispose();
  });
});

describe("三处同源：出站 === engine.get === StateReader", () => {
  it("say 等待画面：dialog/speaker/elements 出站值与两处读口一致", async () => {
    const port = new MemoryI18nPort().table("en", {
      你好: "Hello",
      灵泛: "LingFan",
      第二幕: "Act 2",
    });
    const scene = {
      id: "a",
      kind: "scene",
      elements: [{ type: "text", id: "t1", text: "第二幕" }],
      entry: [{ op: "say", text: "你好", speaker: "灵泛" }],
    };
    const h = makeHarness([scene], port);
    h.engine.start();
    const seen = new Map<string, unknown>();
    const off = h.engine.onStateChanged((c) => seen.set(c.key, c.value));
    await h.engine.setLanguage("en");
    off();
    const reader = createStateReader(h.engine);
    for (const key of [
      SYS.currentDialogText,
      SYS.currentDialogSpeaker,
      SYS.elements,
    ]) {
      expect(seen.get(key)).toEqual(h.engine.get(key));
    }
    expect(reader.dialogText()).toBe("Hello");
    expect(reader.dialogSpeaker()).toBe("LingFan");
    expect(reader.elements()).toEqual(h.engine.get(SYS.elements));
    h.dispose();
  });

  it("menu/input 等待画面：出站值与读口一致", async () => {
    const port = new MemoryI18nPort().table("en", {
      选择: "Choose",
      攻击: "Attack",
      输入: "Input",
      是: "Yes",
    });
    const h = makeHarness(
      [
        column("a", [
          {
            op: "menu",
            prompt: "选择",
            options: [{ text: "攻击", target: "b" }],
          },
        ]),
        column("b", [
          {
            op: "input",
            prompt: "输入",
            store: "answer",
            options: [{ text: "是", value: "yes" }],
          },
        ]),
      ],
      port,
    );
    h.engine.start();
    const seen = new Map<string, unknown>();
    const off = h.engine.onStateChanged((c) => seen.set(c.key, c.value));
    await h.engine.setLanguage("en");
    const reader = createStateReader(h.engine);
    expect(seen.get(SYS.menuPrompt)).toEqual(h.engine.get(SYS.menuPrompt));
    expect(reader.menuPrompt()).toBe("Choose");
    expect(reader.menuChoices()).toEqual([{ text: "Attack", target: "b" }]);
    h.engine.choose("b");
    expect(seen.get(SYS.inputPrompt)).toEqual(h.engine.get(SYS.inputPrompt));
    expect(reader.inputPrompt()).toBe("Input");
    expect(reader.inputCandidates()).toEqual([{ text: "Yes", value: "yes" }]);
    off();
    h.dispose();
  });
});

describe("元素读口：内部寻址原始态，宿主读口译文", () => {
  it("elements 递归派生；engine.elements() 保持原文供内部寻址", async () => {
    const port = new MemoryI18nPort().table("en", {
      第二幕: "Act 2",
      出发: "Go",
    });
    const scene = {
      id: "a",
      kind: "scene",
      elements: [
        { type: "text", id: "t1", text: "第二幕" },
        {
          type: "vbox",
          id: "box",
          children: [{ type: "text", id: "t2", text: "出发" }],
        },
      ],
      entry: [{ op: "say", text: "你好" }],
    };
    const h = makeHarness([scene], port);
    await h.engine.setLanguage("en");
    h.engine.start();
    const derived = h.engine.get(SYS.elements) as Array<{
      props: Record<string, unknown>;
      children: Array<{ props: Record<string, unknown> }>;
    }>;
    expect(derived[0].props.text).toBe("Act 2");
    expect(derived[1].children[0].props.text).toBe("Go");
    // 内部寻址/变异通道读原始态（派生会写坏状态）
    expect(h.engine.elements()[0].props.text).toBe("第二幕");
    expect(createStateReader(h.engine).elements()).toEqual(derived);
    h.dispose();
  });
});

describe("NVL 存原文重译", () => {
  it("buffer 状态存原文；读口与切语言后按当前语言派生", async () => {
    const port = new MemoryI18nPort()
      .table("en", { 第一段: "One", 第二段: "Two" })
      .table("ja", { 第一段: "一", 第二段: "二" });
    const h = makeHarness(
      [
        column("a", [
          { op: "nvl" },
          { op: "say", text: "第一段" },
          { op: "say", text: "第二段" },
        ]),
      ],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    h.engine.advance();
    expect(savedState(h.engine, SYS.nvlBuffer)).toEqual(["第一段", "第二段"]);
    expect(createStateReader(h.engine).nvlLines()).toEqual(["One", "Two"]);
    await h.engine.setLanguage("ja");
    expect(createStateReader(h.engine).nvlLines()).toEqual(["一", "二"]);
    h.dispose();
  });
});

describe("性能护栏与帧栈不变", () => {
  it("未切语言时重复读零查表（派生缓存命中，引用稳定）", async () => {
    const port = new MemoryI18nPort().table("en", {
      你好: "Hello",
      选择: "Choose",
      攻击: "Attack",
    });
    const h = makeHarness(
      [
        column("a", [
          { op: "say", text: "你好" },
          {
            op: "menu",
            prompt: "选择",
            options: [{ text: "攻击", target: "b" }],
          },
        ]),
        column("b", [{ op: "say", text: "结束" }]),
      ],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    h.engine.advance(); // 菜单等待画面
    const lookups = countLookups(h.engine);
    const reader = createStateReader(h.engine);
    const first = h.engine.get(SYS.menuOptions);
    for (let i = 0; i < 50; i += 1) {
      expect(h.engine.get(SYS.menuOptions)).toBe(first); // 引用相等=缓存命中
      expect(h.engine.get(SYS.currentDialogText)).toBe("");
      reader.menuChoices();
      reader.dialogText();
    }
    expect(lookups()).toBe(0);
    h.dispose();
  });

  it("切语言查表次数≈可见表面，远小于译文表规模", async () => {
    const big: Record<string, string> = { 你好: "Hello" };
    for (let i = 0; i < 400; i += 1) big[`词${i}`] = `W${i}`;
    const port = new MemoryI18nPort().table("en", big);
    const h = makeHarness([column("a", [{ op: "say", text: "你好" }])], port);
    h.engine.start(); // 单句对话等待，无元素无 NVL
    const lookups = countLookups(h.engine);
    await h.engine.setLanguage("en");
    expect(lookups()).toBeLessThan(16); // 可见表面只有对话文本（+说话人空串不查表）
    expect(lookups()).toBeLessThan(Object.keys(big).length);
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.dispose();
  });

  it("合并只在供给时发生——读与推进不触发端口调用", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness(
      [
        column("a", [
          { op: "say", text: "你好" },
          { op: "say", text: "你好" },
        ]),
      ],
      port,
    );
    await h.engine.setLanguage("en");
    expect(h.port.calls).toEqual(["en"]);
    h.engine.start();
    const reader = createStateReader(h.engine);
    for (let i = 0; i < 20; i += 1) {
      h.engine.get(SYS.currentDialogText);
      reader.dialogText();
    }
    h.engine.advance();
    expect(h.port.calls).toEqual(["en"]);
    h.dispose();
  });

  it("状态无 *_translated 旁键，原文单存", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness([column("a", [{ op: "say", text: "你好" }])], port);
    await h.engine.setLanguage("en");
    h.engine.start();
    const save = h.engine.exportSave()!;
    const keys = save.state.map(([k]) => k);
    expect(keys.filter((k) => /translated/i.test(k))).toEqual([]);
    expect(keys.filter((k) => k === SYS.currentDialogText)).toHaveLength(1);
    h.dispose();
  });

  it("切语言立即生效且帧栈不动（不重放、不改坐标）", async () => {
    const port = new MemoryI18nPort().table("en", {
      你好: "Hello",
      再见: "Goodbye",
    });
    const h = makeHarness(
      [
        column("a", [
          { op: "say", text: "你好" },
          { op: "say", text: "再见" },
        ]),
      ],
      port,
    );
    h.engine.start();
    h.engine.advance(); // 提交检查点，第二句等待
    const depth = h.engine.historyLength;
    const cursor = h.engine.historyCursor;
    const coords = h.engine.historyView().map((e) => e.coord);
    await h.engine.setLanguage("en");
    expect(h.engine.get(SYS.currentDialogText)).toBe("Goodbye");
    expect(h.engine.get(SYS.waiting)).toBe("dialog");
    expect(h.engine.historyLength).toBe(depth);
    expect(h.engine.historyCursor).toBe(cursor);
    // 帧栈坐标不动；历史面板文本按当前语言重新派生（显示层变化不是重放）
    expect(h.engine.historyView().map((e) => e.coord)).toEqual(coords);
    expect(h.errors).toEqual([]);
    h.dispose();
  });
});

/**
 * 01 §四.3 I18N 三层测试（对齐老引擎 I18nService 思想）。
 * 锚点：
 * - translate-before-interpolate（先 Translate 后插值：overlay 键含 {var} 占位符）
 * - missing-translation-falls-back（缺译文回退原文；空串译文 = 命中——老引擎 TryGetValue 同语义）
 * - hook-points（say 文本/menu prompt+选项/input prompt/notify 文本；speaker 与 menu 目标不翻译）
 * - set-language-semantics（老引擎 SwitchLanguage：清缓存 + 写状态键，当前画面不重放）
 * - lazy-load（按需加载：不 setLanguage 则端口零调用——启动零成本）
 * - overlay-fail-closed（供给失败保持原语言与译文表，engine.error 上报）
 * - replay-translates-current（检查点重放按当前语言重新 Translate）
 * I18nPort 为契约替身；Rust 侧文件列举/解密在 cargo 测（project_files.rs），两侧各测一半。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan/engine";
import {
  SYS,
  StoryEngine,
  mergeOverlayFiles,
  parseStory,
} from "@lingfan/engine";

/** I18nPort 契约替身：内存译文表 + 调用记录 + 定点故障注入 */
class MemoryI18nPort {
  readonly calls: string[] = [];
  private readonly tables = new Map<string, Record<string, string>>();
  private readonly failLangs = new Set<string>();

  table(lang: string, entries: Record<string, string>): this {
    this.tables.set(lang, entries);
    return this;
  }

  failOn(lang: string): this {
    this.failLangs.add(lang);
    return this;
  }

  async loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    this.calls.push(lang);
    if (this.failLangs.has(lang)) throw new Error("供给断路");
    return [{ path: "main.json", entries: this.tables.get(lang) ?? {} }];
  }
}

interface Harness {
  engine: StoryEngine;
  port: MemoryI18nPort;
  errors: string[];
  dispose: () => void;
}

function makeHarness(
  columns: object[],
  port?: MemoryI18nPort,
  entry = "a",
  defines?: Record<string, unknown>,
): Harness {
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

function say(text: string): object {
  return { op: "say", text };
}

describe("01 §四.3 mergeOverlayFiles（main.json 兜底 + 按序覆盖）", () => {
  it("main.json 最先兜底，其余文件按供给顺序覆盖（与列表位置无关）", () => {
    const merged = mergeOverlayFiles([
      { path: "ui/b.json", entries: { 攻击: "b-覆盖", 防御: "b-防御" } },
      { path: "main.json", entries: { 攻击: "main-兜底", 道具: "main-道具" } },
      { path: "ui/a.json", entries: { 防御: "a-覆盖" } },
    ]);
    expect(merged.get("攻击")).toBe("b-覆盖"); // 非 main 覆盖 main
    expect(merged.get("防御")).toBe("a-覆盖"); // 后供给覆盖先供给
    expect(merged.get("道具")).toBe("main-道具"); // main 兜底
  });

  it("无 main.json 时全部按供给顺序合并", () => {
    const merged = mergeOverlayFiles([
      { path: "a.json", entries: { k: "a" } },
      { path: "b.json", entries: { k: "b" } },
    ]);
    expect(merged.get("k")).toBe("b");
  });
});

describe("01 §四.3 按需加载（老引擎：启动零成本）", () => {
  it("不 setLanguage 则端口零调用，文本原文直出", () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness([column("a", [say("你好")])], port);
    h.engine.start();
    expect(port.calls).toHaveLength(0);
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    h.dispose();
  });

  it("start 后 SYS.currentLanguage 恒有定义（空串 = 默认语言）", () => {
    const h = makeHarness([column("a", [say("x")])]);
    h.engine.start();
    expect(h.engine.get(SYS.currentLanguage)).toBe("");
    h.dispose();
  });
});

describe("01 §四.3 先 Translate 后插值（锚点: translate-before-interpolate）", () => {
  it("say：译文上的 {var} 占位符被插值（overlay 键含占位符，老引擎素材同构）", async () => {
    const port = new MemoryI18nPort().table("en", {
      "你有 {gold} 金币": "You have {gold} gold",
    });
    const h = makeHarness([column("a", [say("你有 {gold} 金币")])], port, "a", {
      gold: 5,
    });
    await h.engine.setLanguage("en"); // start 前选语言（标题画面语义）
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("You have 5 gold");
    h.dispose();
  });

  it("say：命中译文用译文，缺译文回退原文", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness([column("a", [say("你好"), say("再见")])], port);
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("再见");
    h.dispose();
  });

  it("say：空串译文 = 命中（老引擎 TryGetValue 同语义）", async () => {
    const port = new MemoryI18nPort().table("en", { 隐藏句: "" });
    const h = makeHarness([column("a", [say("隐藏句")])], port);
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("");
    h.dispose();
  });
});

describe("01 §四.3 挂接点（对齐老引擎 hook：say/menu/input/notify）", () => {
  it("menu：prompt 与选项翻译，目标列名不翻译", async () => {
    const port = new MemoryI18nPort().table("en", {
      选择行动: "Choose action",
      攻击: "Attack",
    });
    const h = makeHarness(
      [
        column("a", [
          {
            op: "menu",
            prompt: "选择行动",
            options: [
              { text: "攻击", target: "b" },
              { text: "逃跑", target: "c" },
            ],
          },
        ]),
      ],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(h.engine.get(SYS.menuPrompt)).toBe("Choose action");
    expect(h.engine.get(SYS.menuOptions)).toEqual(["Attack", "逃跑"]);
    expect(h.engine.get(SYS.menuTargets)).toEqual(["b", "c"]);
    h.dispose();
  });

  it("input：prompt 翻译", async () => {
    const port = new MemoryI18nPort().table("en", { 你的名字: "Your name" });
    const h = makeHarness(
      [column("a", [{ op: "input", prompt: "你的名字", store: "name" }])],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(h.engine.get(SYS.inputPrompt)).toBe("Your name");
    h.engine.input("灵泛");
    h.dispose();
  });

  it("notify：出站 toast 文本翻译", async () => {
    const port = new MemoryI18nPort().table("en", { 获得道具: "Got item" });
    const h = makeHarness(
      [column("a", [{ op: "notify", text: "获得道具" }, say("x")])],
      port,
    );
    const notes: string[] = [];
    const off = h.engine.onEvent((e) => {
      if (e.payload.kind === "notify") notes.push(e.payload.text);
    });
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(notes).toEqual(["Got item"]);
    off();
    h.dispose();
  });

  it("speaker 不走 Translate（角色名归 character 注册表，老引擎 hook 点不含说话人）", async () => {
    const port = new MemoryI18nPort().table("en", { 少女: "Girl" });
    const h = makeHarness(
      [column("a", [{ op: "say", text: "x", speaker: "少女" }])],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogSpeaker)).toBe("少女");
    h.dispose();
  });
});

describe("01 §四.3 setLanguage（老引擎 SwitchLanguage 语义）", () => {
  it("写系统键（ValueChanged scope=system 可观察）；当前画面不重放", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness([column("a", [say("你好")])], port);
    const changes: unknown[] = [];
    const off = h.engine.onStateChanged((c) => {
      if (c.key === SYS.currentLanguage) changes.push(c.value);
    });
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    await h.engine.setLanguage("en");
    expect(changes).toEqual(["en"]);
    expect(h.engine.get(SYS.currentLanguage)).toBe("en");
    // 老引擎语义：切换不重放当前画面（下次 Translate 生效）
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    h.engine.advance();
    off();
    h.dispose();
  });

  it("空串 = 回默认语言：清译文表，后续文本原文直出", async () => {
    const port = new MemoryI18nPort().table("en", { 你好: "Hello" });
    const h = makeHarness(
      [column("a", [say("你好"), say("你好"), say("你好")])],
      port,
    );
    await h.engine.setLanguage("en");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    await h.engine.setLanguage("");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    expect(h.engine.get(SYS.currentLanguage)).toBe("");
    h.dispose();
  });

  it("无端口：语言状态照记，译文表空 = 原文直出（契约缺省语义）", async () => {
    const h = makeHarness([column("a", [say("你好")])]);
    await h.engine.setLanguage("en");
    expect(h.engine.get(SYS.currentLanguage)).toBe("en");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    h.dispose();
  });

  it("非字符串参数 fail-closed", async () => {
    const h = makeHarness([column("a", [say("x")])]);
    await h.engine.setLanguage(42 as unknown as string);
    expect(h.errors).toContain("i18n-lang-invalid");
    expect(h.engine.get(SYS.currentLanguage)).toBeUndefined();
    h.dispose();
  });
});

describe("01 §四.3 供给失败 fail-closed", () => {
  it("端口拒绝：保持原语言与译文表不变，engine.error 上报", async () => {
    const port = new MemoryI18nPort()
      .table("en", { 你好: "Hello" })
      .failOn("de");
    const h = makeHarness([column("a", [say("你好")])], port);
    await h.engine.setLanguage("en");
    await h.engine.setLanguage("de");
    expect(h.errors).toContain("i18n-overlay-failed");
    expect(h.engine.get(SYS.currentLanguage)).toBe("en");
    h.engine.start();
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello"); // en 表仍生效
    h.dispose();
  });
});

describe("01 §四.3 重放按当前语言 Translate（锚点: replay-translates-current）", () => {
  it("切换语言后回溯：重放文本为新语言，旧语言条目随整表重建消失", async () => {
    const port = new MemoryI18nPort()
      .table("en", { 你好: "Hello", 再见: "Bye" })
      .table("ja", { 你好: "こんにちは" });
    const h = makeHarness([column("a", [say("你好"), say("再见")])], port);
    h.engine.start(); // 默认语言：原文直出
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    h.engine.advance(); // 提交检查点 a:0；「再见」上屏
    await h.engine.setLanguage("ja");
    h.engine.back(); // 回检查点 a:0 → 重放 say（ja 译文表）
    expect(h.engine.get(SYS.currentDialogText)).toBe("こんにちは");
    h.engine.advance();
    expect(h.engine.get(SYS.currentDialogText)).toBe("再见"); // en 条目已消失（缺译文回退）
    h.dispose();
  });
});

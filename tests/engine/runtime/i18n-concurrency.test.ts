/**
 * setLanguage 并发与失败语义（后写胜 / fail-closed / 错误出站 / 幂等）。
 * - 供给异步、查表同步：快速连续切换只认最后一次请求（序号守卫）
 * - 被丢弃的请求不出错、不出站（正常竞争不是失败）
 * - 最新请求供给失败：语言与译文表都不变，只出站一次 i18n-overlay-failed
 * - 换表与重译同一同步块：出站事件值已是新表译文，无「新表旧值」中间态
 * - 幂等：同语言重复设置不重复供给、不重复出站
 * I18nPort 为契约替身：Deferred 港手动控制每笔供给的完成时机与成败。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

interface PendingSupply {
  resolve: (files: I18nOverlayFile[]) => void;
  reject: (reason: Error) => void;
}

/** I18nPort 契约替身：每笔供给挂起，测试手动 settle/fail（按语言排队） */
class DeferredI18nPort {
  readonly calls: string[] = [];
  private readonly tables = new Map<string, Record<string, string>>();
  private readonly pending = new Map<string, PendingSupply[]>();

  table(lang: string, entries: Record<string, string>): this {
    this.tables.set(lang, entries);
    return this;
  }

  loadOverlayFiles(lang: string): Promise<I18nOverlayFile[]> {
    this.calls.push(lang);
    return new Promise<I18nOverlayFile[]>((resolve, reject) => {
      const queue = this.pending.get(lang) ?? [];
      queue.push({ resolve, reject });
      this.pending.set(lang, queue);
    });
  }

  settle(lang: string): void {
    this.pending
      .get(lang)
      ?.shift()
      ?.resolve([{ path: "main.json", entries: this.tables.get(lang) ?? {} }]);
  }

  fail(lang: string): void {
    this.pending.get(lang)?.shift()?.reject(new Error("供给断路"));
  }
}

/** 自动完成的契约替身（幂等用例不需要手动控制时机） */
class AutoI18nPort {
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

function makeHarness<P extends DeferredI18nPort | AutoI18nPort>(port: P) {
  const engine = new StoryEngine(
    parseStory({
      formatVersion: 1,
      id: "t",
      entry: "a",
      columns: [
        { id: "a", kind: "flow", commands: [{ op: "say", text: "你好" }] },
      ],
    }),
    { i18nPort: port },
  );
  const errors: string[] = [];
  const offError = engine.onEvent((e) => {
    if (e.payload.kind === "engine.error") errors.push(e.payload.code);
  });
  const changes: Array<{ key: string; value: unknown }> = [];
  const offState = engine.onStateChanged((c) =>
    changes.push({ key: c.key, value: c.value }),
  );
  engine.start(); // 原文等待画面；切换语义从清空观测开始
  changes.length = 0;
  return {
    engine,
    port,
    errors,
    changes,
    dispose: () => {
      offError();
      offState();
      engine.dispose();
    },
  };
}

const EN = { 你好: "Hello" };
const JA = { 你好: "こんにちは" };
const FR = { 你好: "Bonjour" };

describe("后写胜：序号守卫", () => {
  it("快速连续切换只认最后一次；先发的迟到供给被丢弃", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA),
    );
    const p1 = h.engine.setLanguage("en");
    const p2 = h.engine.setLanguage("ja");
    h.port.settle("ja"); // 后发先至
    await p2;
    h.port.settle("en"); // 先发迟到 → 丢弃
    await p1;
    expect(h.engine.get(SYS.currentLanguage)).toBe("ja");
    expect(h.engine.get(SYS.currentDialogText)).toBe("こんにちは");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("被丢弃的请求不出站：语言键与派生键都只留最后一次的值", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA),
    );
    const p1 = h.engine.setLanguage("en");
    const p2 = h.engine.setLanguage("ja");
    h.port.settle("ja");
    await p2;
    h.port.settle("en");
    await p1;
    expect(
      h.changes
        .filter((c) => c.key === SYS.currentLanguage)
        .map((c) => c.value),
    ).toEqual(["ja"]);
    expect(
      h.changes
        .filter((c) => c.key === SYS.currentDialogText)
        .map((c) => c.value),
    ).toEqual(["こんにちは"]);
    h.dispose();
  });

  it("被丢弃的失败也不出站（竞争丢弃先于失败判定）", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA),
    );
    const p1 = h.engine.setLanguage("en");
    const p2 = h.engine.setLanguage("ja");
    h.port.settle("ja");
    await p2;
    h.port.fail("en"); // 迟到且失败 → 静默丢弃
    await p1;
    expect(h.errors).toEqual([]);
    expect(h.engine.get(SYS.currentLanguage)).toBe("ja");
    h.dispose();
  });

  it("三连切 en→ja→fr 乱序完成，最终 = 最后一次", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA).table("fr", FR),
    );
    const p1 = h.engine.setLanguage("en");
    const p2 = h.engine.setLanguage("ja");
    const p3 = h.engine.setLanguage("fr");
    h.port.settle("ja");
    h.port.settle("en");
    h.port.settle("fr");
    await Promise.all([p1, p2, p3]);
    expect(h.engine.get(SYS.currentLanguage)).toBe("fr");
    expect(h.engine.get(SYS.currentDialogText)).toBe("Bonjour");
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("幂等早退也是最新意图：更早的挂起供给仍被丢弃", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA),
    );
    const p1 = h.engine.setLanguage("en");
    h.port.settle("en");
    await p1;
    h.changes.length = 0;
    const p2 = h.engine.setLanguage("ja"); // 挂起中
    await h.engine.setLanguage("en"); // 幂等早退，但必须使 ja 失效
    h.port.settle("ja"); // 迟到供给 → 丢弃
    await p2;
    expect(h.engine.get(SYS.currentLanguage)).toBe("en");
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    expect(h.changes).toEqual([]);
    expect(h.errors).toEqual([]);
    h.dispose();
  });

  it("默认语言幂等早退同样使挂起的非默认请求失效", async () => {
    const h = makeHarness(new DeferredI18nPort().table("en", EN));
    const p1 = h.engine.setLanguage("en"); // 挂起中（当前仍是默认语言）
    await h.engine.setLanguage(""); // 幂等早退（默认 + 表未装配）
    h.port.settle("en"); // 迟到供给 → 丢弃
    await p1;
    expect(h.engine.get(SYS.currentLanguage)).toBe("");
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    expect(h.changes).toEqual([]);
    h.dispose();
  });
});

describe("fail-closed：最新请求供给失败", () => {
  it("语言与译文表都不变、不重译；只出站一次 i18n-overlay-failed", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA),
    );
    const p1 = h.engine.setLanguage("en");
    h.port.settle("en");
    await p1;
    h.changes.length = 0;
    const p2 = h.engine.setLanguage("ja");
    h.port.fail("ja");
    await p2;
    expect(h.errors).toEqual(["i18n-overlay-failed"]);
    expect(h.engine.get(SYS.currentLanguage)).toBe("en");
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    expect(h.changes).toEqual([]); // 失败不改语言、不重译、不出站
    h.dispose();
  });

  it("失败后可重试：序号守卫不卡死后续请求", async () => {
    const h = makeHarness(
      new DeferredI18nPort().table("en", EN).table("ja", JA),
    );
    const p1 = h.engine.setLanguage("en");
    h.port.settle("en");
    await p1;
    const p2 = h.engine.setLanguage("ja");
    h.port.fail("ja");
    await p2;
    const p3 = h.engine.setLanguage("ja");
    h.port.settle("ja");
    await p3;
    expect(h.engine.get(SYS.currentLanguage)).toBe("ja");
    expect(h.engine.get(SYS.currentDialogText)).toBe("こんにちは");
    expect(h.errors).toEqual(["i18n-overlay-failed"]);
    h.dispose();
  });
});

describe("同步块与幂等", () => {
  it("换表与重译同一同步块：出站事件值已是新表译文", async () => {
    const h = makeHarness(new DeferredI18nPort().table("en", EN));
    const p = h.engine.setLanguage("en");
    h.port.settle("en");
    await p;
    const dialogEvents = h.changes.filter(
      (c) => c.key === SYS.currentDialogText,
    );
    expect(dialogEvents.map((c) => c.value)).toEqual(["Hello"]);
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.dispose();
  });

  it("幂等：同语言重复设置不重复供给、不重复出站", async () => {
    const h = makeHarness(new AutoI18nPort().table("en", EN));
    await h.engine.setLanguage("en");
    expect(h.port.calls).toEqual(["en"]);
    h.changes.length = 0;
    await h.engine.setLanguage("en");
    expect(h.port.calls).toEqual(["en"]);
    expect(h.changes).toEqual([]);
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.dispose();
  });

  it("默认语言路径同步生效：清空译文表，派生键出站原文", async () => {
    const h = makeHarness(new DeferredI18nPort().table("en", EN));
    const p1 = h.engine.setLanguage("en");
    h.port.settle("en");
    await p1;
    h.changes.length = 0;
    await h.engine.setLanguage(""); // 无供给、无 await 夹缝
    expect(h.port.calls).toEqual(["en"]);
    expect(h.engine.get(SYS.currentLanguage)).toBe("");
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好");
    expect(
      h.changes
        .filter((c) => c.key === SYS.currentDialogText)
        .map((c) => c.value),
    ).toEqual(["你好"]);
    h.dispose();
  });
});

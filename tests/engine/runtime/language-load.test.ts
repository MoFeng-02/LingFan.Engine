/**
 * 读档跨语言 overlay 重建回归（「存档语言赢」真正生效）。
 *
 * 语言标签 SYS.currentLanguage 随存档持久化，但译文表 ctx.overlay 只在 setLanguage
 * 重建。读档若只恢复标签而不失效译文表，宿主补调 setLanguage(档内语言) 会命中幂等早退
 * （标签相同 && overlay 非空）→ 画面仍是读档前的旧语言。修法：importSave 恢复状态后
 * 置 ctx.overlay=null（读档=会话重开），宿主 load.done 补调 setLanguage 才会重建。
 *
 * 证伪锚：删掉 import.ts 的 `ctx.overlay=null` 一行，本册「读档后画面回到档内语言」转红。
 */
import { describe, expect, it, vi } from "vitest";
import type {
  I18nOverlayFile,
  SaveMode,
  SlotSummary,
} from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

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

class MemorySavePort {
  private readonly slots = new Map<string, string>();
  async write(slot: string, payload: string, _mode: SaveMode): Promise<void> {
    this.slots.set(slot, payload);
  }
  async read(slot: string): Promise<string> {
    const raw = this.slots.get(slot);
    if (raw === undefined) throw new Error(`槽位不存在：${slot}`);
    return raw;
  }
  async remove(slot: string): Promise<void> {
    this.slots.delete(slot);
  }
  async list(): Promise<SlotSummary[]> {
    return [...this.slots.keys()].map((slot) => ({
      slot,
      saveCount: 1,
      timestamp: 0,
      mode: "machine-bound" as SaveMode,
    }));
  }
  has(slot: string): boolean {
    return this.slots.has(slot);
  }
}

function makeEngine() {
  const i18nPort = new MemoryI18nPort()
    .table("en", { 你好: "Hello", 再见: "Goodbye" })
    .table("ja", { 你好: "こんにちは", 再见: "さようなら" });
  const savePort = new MemorySavePort();
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
            { op: "say", text: "你好" },
            { op: "say", text: "再见" },
          ],
        },
      ],
    }),
    { i18nPort, savePort },
  );
  return { engine, savePort };
}

describe("读档跨语言 overlay 重建（存档语言赢）", () => {
  it("en 存档 → 切到 ja → 读档补调 setLanguage → 画面回到 en", async () => {
    const { engine, savePort } = makeEngine();
    engine.start();
    await engine.setLanguage("en");
    expect(engine.get(SYS.currentDialogText)).toBe("Hello");
    expect(engine.save("s1")).toBe(true);
    await vi.waitFor(() => expect(savePort.has("s1")).toBe(true));

    // 读档前切到 ja：译文表此刻是 ja
    await engine.setLanguage("ja");
    expect(engine.get(SYS.currentDialogText)).toBe("こんにちは");

    // 读档：恢复档内语言标签 en，并失效译文表（会话重开）
    engine.load("s1");
    await vi.waitFor(() => expect(engine.get(SYS.currentLanguage)).toBe("en"));

    // 宿主 load.done 补调 setLanguage(档内语言)：overlay 已失效 → 重建为 en
    await engine.setLanguage(String(engine.get(SYS.currentLanguage) ?? ""));
    await vi.waitFor(() =>
      expect(engine.get(SYS.currentDialogText)).toBe("Hello"),
    );
    expect(engine.get(SYS.currentLanguage)).toBe("en");
    engine.dispose();
  });

  it("ja 存档 → 切到 en → 读档补调 → 画面回到 ja（对称）", async () => {
    const { engine, savePort } = makeEngine();
    engine.start();
    await engine.setLanguage("ja");
    expect(engine.get(SYS.currentDialogText)).toBe("こんにちは");
    expect(engine.save("s2")).toBe(true);
    await vi.waitFor(() => expect(savePort.has("s2")).toBe(true));

    await engine.setLanguage("en");
    expect(engine.get(SYS.currentDialogText)).toBe("Hello");

    engine.load("s2");
    await vi.waitFor(() => expect(engine.get(SYS.currentLanguage)).toBe("ja"));
    await engine.setLanguage(String(engine.get(SYS.currentLanguage) ?? ""));
    await vi.waitFor(() =>
      expect(engine.get(SYS.currentDialogText)).toBe("こんにちは"),
    );
    engine.dispose();
  });

  it("读档后继续推进，后续句子也按档内语言翻译", async () => {
    const { engine, savePort } = makeEngine();
    engine.start();
    await engine.setLanguage("en");
    engine.save("s3");
    await vi.waitFor(() => expect(savePort.has("s3")).toBe(true));
    await engine.setLanguage("ja");

    engine.load("s3");
    await vi.waitFor(() => expect(engine.get(SYS.currentLanguage)).toBe("en"));
    await engine.setLanguage(String(engine.get(SYS.currentLanguage) ?? ""));
    await vi.waitFor(() =>
      expect(engine.get(SYS.currentDialogText)).toBe("Hello"),
    );
    engine.advance();
    expect(engine.get(SYS.currentDialogText)).toBe("Goodbye");
    engine.dispose();
  });
});

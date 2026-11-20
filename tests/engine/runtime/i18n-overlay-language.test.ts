/**
 * overlayLanguage 源语言标签自洽回归。
 *
 * 译文表（overlay）带一个源语言标签，记录它当前是哪门语言的表；setLanguage 装配时同步写入。
 * 幂等判据据此验「表的实际源语言」而非 currentLanguage 状态键——让「overlay 是当前语言的表」
 * 这一隐式不变量自明：语言标签相同但表不是这门语言时自检重建，而非凭状态键早退留下失配译文表。
 *
 * 关键场景是回溯：回滚把 currentLanguage 恢复到检查点语言，但译文表是会话态不随快照回滚，
 * 仍停在玩家当前语言（「重放按当前语言」的刻意语义）。此时显式 setLanguage(检查点语言)，
 * currentLanguage 已等于目标语言、表却不是这门语言——旧判据凭状态键早退会留下失配表，
 * 新判据验表源语言发现失配 ⇒ 重建。回滚本身的刻意语义保持不变。
 *
 * 检查点快照在该句首次等待时捕获：要让检查点带上某语言，须在该句等待前切到该语言。
 */
import { describe, expect, it } from "vitest";
import type { I18nOverlayFile } from "@lingfan-engine/core";
import { SYS, StoryEngine, parseStory } from "@lingfan-engine/core";

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

function makeHarness(columns: object[], port: MemoryI18nPort) {
  const engine = new StoryEngine(
    parseStory({ formatVersion: 1, id: "t", entry: "a", columns }),
    { i18nPort: port },
  );
  return {
    engine,
    port,
    dispose: () => engine.dispose(),
  };
}

function column(id: string, commands: object[]): object {
  return { id, kind: "flow", commands };
}

function say(text: string): object {
  return { op: "say", text };
}

const EN = { 你好: "Hello", 再见: "Bye" };
const JA = { 你好: "こんにちは" };

/**
 * 布置一个「检查点语言=en、当前译文表=ja」的回溯态：
 * 三句列，第二句「你好」在 en 下等待 ⇒ 其检查点快照带 currentLanguage=en；
 * 随后切 ja 再 back 回该检查点 ⇒ currentLanguage 恢复 en、表仍 ja（会话态不回滚）。
 */
async function rollbackToEnCheckpointWithJaOverlay(port: MemoryI18nPort) {
  const h = makeHarness(
    [column("a", [say("再见"), say("你好"), say("尾")])],
    port,
  );
  h.engine.start(); // a:0「再见」等待，快照 currentLanguage=""
  await h.engine.setLanguage("en"); // currentLanguage=en
  h.engine.advance(); // a:1「你好」等待，快照 currentLanguage=en
  h.engine.advance(); // a:2「尾」等待
  await h.engine.setLanguage("ja"); // 表=ja，currentLanguage=ja
  h.engine.back(); // 回 a:1：currentLanguage 恢复 en，表仍 ja
  return h;
}

describe("overlayLanguage 源语言标签", () => {
  it("装配译文表后同语言重复设置幂等早退（表源语言相同，不重复供给）", async () => {
    const port = new MemoryI18nPort().table("en", EN);
    const h = makeHarness([column("a", [say("你好")])], port);
    h.engine.start();
    await h.engine.setLanguage("en");
    await h.engine.setLanguage("en"); // 表已是 en ⇒ 早退，不再供给
    expect(port.calls).toEqual(["en"]);
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello");
    h.dispose();
  });

  it("回溯后 currentLanguage 恢复检查点语言、译文表仍停当前语言（重放刻意语义不变）", async () => {
    const port = new MemoryI18nPort().table("en", EN).table("ja", JA);
    const h = await rollbackToEnCheckpointWithJaOverlay(port);
    expect(h.engine.get(SYS.currentLanguage)).toBe("en"); // 检查点语言
    expect(h.engine.get(SYS.currentDialogText)).toBe("こんにちは"); // 重放按当前 ja 表
    h.dispose();
  });

  it("语言标签相同但表源语言不同 ⇒ 自检重建（回溯后显式切回检查点语言）", async () => {
    const port = new MemoryI18nPort().table("en", EN).table("ja", JA);
    const h = await rollbackToEnCheckpointWithJaOverlay(port);
    // 显式切回 en：currentLanguage 已等于 en，表却是 ja ⇒ 验表源语言发现失配，重建。
    // 旧判据凭 currentLanguage===en 早退会留下 ja 表（显示こんにちは、en 只供给一次）⇒ 本断言转红。
    await h.engine.setLanguage("en");
    expect(port.calls.filter((l) => l === "en")).toHaveLength(2); // 第二次 en 真供给（重建）
    expect(h.engine.get(SYS.currentDialogText)).toBe("Hello"); // en 表重建生效
    h.dispose();
  });

  it("回溯到默认语言检查点后切回默认 ⇒ 清表回原文（自检重建，不留失配译文表）", async () => {
    const port = new MemoryI18nPort().table("ja", JA);
    const h = makeHarness([column("a", [say("你好"), say("再见")])], port);
    h.engine.start(); // a:0「你好」等待，默认语言检查点（currentLanguage=""）
    h.engine.advance(); // a:1「再见」等待
    await h.engine.setLanguage("ja"); // 表=ja
    h.engine.back(); // 回 a:0：currentLanguage=""，表仍 ja
    // 切回默认语言：currentLanguage 已等于 ""，表却是 ja ⇒ 自检清表回原文。
    // 旧判据凭 currentLanguage==="" 早退会留下 ja 表（显示こんにちは）⇒ 本断言转红。
    await h.engine.setLanguage("");
    expect(h.engine.get(SYS.currentDialogText)).toBe("你好"); // 原文直出
    h.dispose();
  });
});

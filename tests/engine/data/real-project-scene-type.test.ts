/**
 * 真实工程验证：三种 Lang 布局 + `type=menu` 场景能被解析器识别。
 *
 * 需**仓外真实工程**才能跑：用环境变量 `LFEN_REAL_PROJECT` 指向其资源根
 * （内含 `Stories/` 与 `Lang/`）；未设置时本套件**跳过**（不报错）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStory } from "@lingfan/engine";

/** 真实工程资源根（由环境变量提供；缺省 = 未提供 ⇒ 跳过本套件） */
const ROOT = process.env.LFEN_REAL_PROJECT ?? "";
const hasRealProject = ROOT !== "" && existsSync(ROOT);

function walk(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = base ? `${base}/${name}` : name;
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs, rel) : [rel];
  });
}

const files = hasRealProject ? walk(ROOT) : [];
const storyFiles = files.filter((f) => f.startsWith("Stories/") && f.endsWith(".story"));
const langFiles = files.filter((f) => f.startsWith("Lang/") && f.endsWith(".json"));

describe.skipIf(!hasRealProject)("真实工程 · 场景类型", () => {
  it("工程结构：三Lang 布局并存（平铺 / 子目录分类 / 单文件）", () => {
    const layouts = {
      "Lang/en/*.json（平铺）": langFiles.filter((f) => /^Lang\/en\/[^/]+\.json$/.test(f)).length,
      "Lang/en-US/**/*.json（子目录分类）": langFiles.filter((f) => f.startsWith("Lang/en-US/")).length,
      "Lang/ja-JP.json（单文件）": langFiles.filter((f) => f === "Lang/ja-JP.json").length,
    };
    console.log("三Lang 布局:", JSON.stringify(layouts, null, 1));
    expect(layouts["Lang/en/*.json（平铺）"]).toBeGreaterThan(0);
    expect(layouts["Lang/en-US/**/*.json（子目录分类）"]).toBeGreaterThan(0);
    expect(layouts["Lang/ja-JP.json（单文件）"]).toBe(1);
  });

  it("故事文件按章节分目录（与译文的分章约定同源）", () => {
    const chapters = [
      ...new Set(storyFiles.map((f) => f.split("/")[1])),
    ];
    console.log("故事章节:", JSON.stringify(chapters));
    expect(chapters).toContain("chapter1");
    expect(chapters).toContain("system");
  });

  it("**真实 story 里的 `type=menu` 是当前支持的语义**", () => {
    // 不用正则含引号（易被工具链切坏）——改成字符串判定
    const hasMenu = (text: string): boolean => {
      const line = text.split("\n").find((l) => l.trimStart().startsWith("scene "));
      return line !== undefined && line.includes("type=menu");
    };
    const menuCount = storyFiles.filter((f) =>
      hasMenu(readFileSync(join(ROOT, f), "utf8")),
    ).length;
    const gameCount = storyFiles.length - menuCount;
    console.log(`真实工程场景分布: game=${gameCount} menu=${menuCount}`);
    expect(menuCount).toBeGreaterThan(0);
    expect(gameCount).toBeGreaterThan(0);
  });

  it("**解析器接受 type=menu 且识别为不可回溯**", () => {
    const story = parseStory({
      formatVersion: 1,
      id: "real",
      entry: "title",
      columns: [
        { id: "title", kind: "flow", type: "menu", commands: [{ op: "say", text: "标题" }] },
        { id: "play", kind: "flow", commands: [{ op: "say", text: "剧情" }] },
      ],
    });
    const menu = story.columns.find((c) => c.id === "title");
    const game = story.columns.find((c) => c.id === "play");
    expect(menu?.type).toBe("menu");
    expect(game?.type).toBeUndefined(); // 缺省 = game
  });
});

/**
 * **真实工程端到端守卫**（读磁盘上的真实工程，验端到端能打开）。
 *
 * 真实工程里四类形态叠加，任何一类没处理就打不开：
 * ① 组装器不按目录过滤 ⇒ `Lang/**` 译文表被当故事解析
 * ② `.gitkeep` 被当故事文件（占位文件）
 * ③ `.story` 文本投影不支持列内 `scene "x"` 跳转
 * ④「文件名必须等于列 id」与语义化文件名冲突
 *
 * **真实工程的关键形态**：
 * - **一个 `.story` 文件承载一章的多个场景**（如 `chapter1.story` 含 4 列）
 *   ⇒ 列 id **天然不等于**文件名，这正是「文件名↔id 解耦」的根本原因。
 * - `type=menu` 只标在**该章的首列**，同文件内的演示子列仍是 game。
 * - `Lang/` 下三种布局并存（平铺 / 子目录分类 / 单文件），键 = 中文原文。
 *
 * 守卫口径：读磁盘真实内容（不复制，避免「工程变了」被缓存掩盖）。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assembleProject, serializeProject, type Story } from "@lingfan/engine";
import { analyzeStory } from "@lingfan/editor";

/** 真实工程资源根（由环境变量 `LFEN_REAL_PROJECT` 提供；未提供 ⇒ 跳过本套件） */
const ROOT = process.env.LFEN_REAL_PROJECT ?? "";
const hasRealProject = ROOT !== "" && existsSync(ROOT);

function walk(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = base ? `${base}/${name}` : name;
    const abs = join(dir, name);
    return statSync(abs).isDirectory() ? walk(abs, rel) : [rel];
  });
}

/** 读真实工程（跳过媒体二进制与 `Saves/` 产物） */
function realFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of walk(ROOT)) {
    if (rel.startsWith("Saves/") || rel.includes("/.")) continue;
    if (/\.(mp3|png|jpg|jpeg|webm|mp4|enc)$/i.test(rel)) continue;
    files.set(rel, readFileSync(join(ROOT, rel), "utf8"));
  }
  return files;
}

/**
 * 清单：**自造**（真实工程没有 `project.json`——那是待立项的「降级打开」项）。
 * `entry` 用第一章的真实首列 id。
 */
const MANIFEST = { formatVersion: 1, id: "demo", entry: "chapter1_start" };

function loadReal(): Story {
  return assembleProject(MANIFEST, realFiles());
}

describe.skipIf(!hasRealProject)("真实工程 · **能打开**", () => {
  it("组装成功（四个阻塞全解除：目录过滤/占位文件/scene 跳转/文件名解耦）", () => {
    const story = loadReal();
    // 11 个 `.story` × 每章多列 ⇒ 62 列
    expect(story.columns.length).toBeGreaterThanOrEqual(50);
  });

  it("**场景类型被识别**（`type=menu` 若一律忽略 ⇒ 菜单全变 game）", () => {
    const story = loadReal();
    const menus = story.columns.filter((c) => c.type === "menu");
    // 真实工程 7 章标了 menu（about/audio_demo/dialog_templates/sandbox/trans_demo/video_demo/title_main）
    expect(menus.length).toBeGreaterThanOrEqual(6);
    // 分章的剧情列是 game（缺省）
    const chapters = story.columns.filter((c) => c.id.startsWith("chapter"));
    expect(chapters.length).toBeGreaterThanOrEqual(3);
    for (const c of chapters) expect(c.type ?? "game").toBe("game");
  });

  it("**每列都带来源路径**（写回保真的地基）", () => {
    const story = loadReal();
    for (const c of story.columns) {
      expect(c.sourcePath, `列 ${c.id} 缺 sourcePath`).toMatch(/^Stories\//);
      expect(c.sourcePath!.endsWith(".story")).toBe(true);
    }
    // 同一章的多列共享同一个来源文件
    const chapter1 = story.columns.filter((c) => c.id.startsWith("chapter1_"));
    expect(chapter1.length).toBeGreaterThanOrEqual(3);
    for (const c of chapter1) {
      expect(c.sourcePath).toBe("Stories/chapter1/chapter1.story");
    }
  });

  it("**列内 scene 跳转被投影为 navigate**（跳回标题场景）", () => {
    const story = loadReal();
    const jumps = story.columns
      .flatMap((c) => c.commands ?? [])
      .filter((c) => c.op === "navigate" && c.path === "title_main");
    expect(jumps.length).toBeGreaterThan(0);
  });

  it("**写回不产生拍平产物**（不出现 `Stories/<id>.json`）", () => {
    const story = loadReal();
    const { files } = serializeProject(story, MANIFEST);
    const storyPaths = [...files.keys()].filter((p) => p.startsWith("Stories/"));
    expect(storyPaths.length).toBeGreaterThan(0);
    // 一个都不该是「按 id 重算」的平铺路径
    expect(storyPaths.filter((p) => /\/[^/]+\.json$/.test(p))).toEqual([]);
  });

  it("**工程零 error 诊断**（端到端健康检查：能力齐备 + 工程写法合规）", () => {
    // 这条守卫是**端到端健康检查**：任何一层退化（引擎能力缺失 / 工程写法回退）
    // 都会让它变红。历史上出现过的 error 来源与处置：
    //   `bgm ""`（空资源表停止）→ 引擎诊断人话化 + 工程改 `stop_bgm`
    //   `say color=` → 引擎真支持说话人颜色覆盖
    //   `call <label>` → 引擎支持列（label）目标
    //   未定义变量 + 空 `say ""` → 工程侧补 `define` / 改 `pause`
    const story = loadReal();
    const errors = analyzeStory(story).filter((d) => d.severity === "error");
    expect(
      errors.map((e) => `${e.code}: ${e.message}`),
      "真实工程不该有 error 级诊断",
    ).toEqual([]);
  });
});

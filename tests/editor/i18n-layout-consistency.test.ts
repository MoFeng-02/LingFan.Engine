/**
 * i18n 统一落位互锁测试。
 *
 * 测试要点：
 * - **L2 三布局键集合一致**：single / main / per-story 只改文件组织，不改键集合；
 * - **L3 宿主键 ⊆ 合并键集**：骨架喂回合并视图后宿主键无一丢失；
 * - **落位分组**：故事组插入序 + 宿主归属映射（多源同文件组内合并）；
 * - **增量判据**：孤儿键默认保留只报告、prune 显式删除；幂等连跑逐字节零改动；
 * - **合并视图**：main.json 兜底最先 + 路径码元序供给，后写胜（core 语义不复写）；
 * - **fail-closed**：宿主 overlay 路径段级越界即抛。
 */
import { describe, expect, it } from "vitest";
import {
  LANG_DIR,
  mergeOverlayView,
  planOverlayPlacement,
  planOverlaySkeleton,
  prunedOverlayKeys,
  type SkeletonLayout,
} from "@lingfan-engine/editor";

const LAYOUTS: readonly SkeletonLayout[] = ["single", "main", "per-story"];

const storyKeys = new Map([
  ["start", ["你好", "世界"]],
  ["chapter1/tavern", ["炉火", "你好"]],
]);
const hostKeys = new Map([
  ["src/host/panels/shop.ts", ["商店标题", "你好"]],
  ["src/host/ui.ts", ["宿主通用"]],
  ["src/shared/text.ts", ["共享文案"]],
]);

function keysOf(
  files: readonly { entries: Record<string, string> }[],
): string[] {
  const keys = new Set<string>();
  for (const file of files) {
    for (const key of Object.keys(file.entries)) keys.add(key);
  }
  return [...keys].sort();
}

/* ———————————————— L2 / L3 互锁 ———————————————— */

describe("L2：三布局键集合完全相同（顺序可不同）", () => {
  it("故事 + 宿主混合输入下三布局键集合一致", () => {
    const sets = LAYOUTS.map((layout) =>
      keysOf(planOverlaySkeleton({ lang: "en", layout, storyKeys, hostKeys })),
    );
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
    expect(sets[0]).toEqual(
      ["你好", "世界", "炉火", "商店标题", "宿主通用", "共享文案"].sort(),
    );
  });

  it("空输入：single/main 仍产一个空文件，per-story 产零个文件（键集合都为空）", () => {
    const empty = new Map<string, string[]>();
    for (const layout of LAYOUTS) {
      const files = planOverlaySkeleton({
        lang: "en",
        layout,
        storyKeys: empty,
      });
      expect(keysOf(files), layout).toEqual([]);
      expect(files.length, layout).toBe(layout === "per-story" ? 0 : 1);
    }
  });
});

describe("L3：宿主键 ⊆ 合并后 overlay 键集", () => {
  it("三布局骨架喂回合并视图，宿主键无一丢失", () => {
    const hostUnion = ["商店标题", "你好", "宿主通用", "共享文案"];
    for (const layout of LAYOUTS) {
      const files = planOverlaySkeleton({
        lang: "en",
        layout,
        storyKeys,
        hostKeys,
      });
      // 供给路径相对 Lang/{lang}/（single 形态归一为 main.json）
      const merged = mergeOverlayView(
        files.map((file) => ({
          path:
            layout === "single"
              ? "main.json"
              : file.path.slice(`${LANG_DIR}/en/`.length),
          entries: file.entries,
        })),
      );
      for (const key of hostUnion) {
        expect(merged.entries.has(key), `${layout}:${key}`).toBe(true);
      }
    }
  });
});

/* ———————————————— 落位分组（唯一声明点） ———————————————— */

describe("落位分组：布局 × 来源 → 文件", () => {
  it("single/main：故事 + 宿主全进同一文件", () => {
    const single = planOverlayPlacement({
      lang: "en",
      layout: "single",
      storyKeys,
      hostKeys,
    });
    expect(single.map((group) => group.path)).toEqual(["Lang/en.json"]);
    // 组内键 = 来源首现序（故事插入序 + 宿主首现序），序列化层再排序
    expect(single[0]?.keys).toEqual([
      "你好",
      "世界",
      "炉火",
      "商店标题",
      "宿主通用",
      "共享文案",
    ]);
    const main = planOverlayPlacement({
      lang: "en",
      layout: "main",
      storyKeys,
      hostKeys,
    });
    expect(main.map((group) => group.path)).toEqual(["Lang/en/main.json"]);
  });

  it("per-story：故事组插入序在前，宿主按归属映射追加（多源同文件合并）", () => {
    const groups = planOverlayPlacement({
      lang: "en",
      layout: "per-story",
      storyKeys,
      hostKeys,
    });
    expect(groups.map((group) => group.path)).toEqual([
      "Lang/en/start.json",
      "Lang/en/chapter1/tavern.json",
      "Lang/en/host/panels/shop.json",
      "Lang/en/host/main.json",
      "Lang/en/main.json",
    ]);
    // ui.ts 有 src/host 锚点 → host/main.json；shared 无锚点 → main.json 兜底
    expect(groups[3]?.keys).toEqual(["宿主通用"]);
    expect(groups[4]?.keys).toEqual(["共享文案"]);
  });

  it("宿主与故事落同一文件时组内合并去重（故事 main 与宿主兜底同名）", () => {
    const groups = planOverlayPlacement({
      lang: "en",
      layout: "per-story",
      storyKeys: new Map([["main", ["故事键"]]]),
      hostKeys: new Map([["src/shared/text.ts", ["宿主键", "故事键"]]]),
    });
    expect(groups).toEqual([
      { path: "Lang/en/main.json", keys: ["故事键", "宿主键"] },
    ]);
  });

  it("fail-closed：宿主 overlay 路径段级越界即抛（.. 段）", () => {
    expect(() =>
      planOverlayPlacement({
        lang: "en",
        layout: "per-story",
        storyKeys: new Map(),
        hostKeys: new Map([["src/host/panels/../../evil.ts", ["键"]]]),
      }),
    ).toThrow();
  });
});

/* ———————————————— 增量判据与幂等 ———————————————— */

describe("增量：孤儿键保留只报告，prune 显式删除", () => {
  const existing = new Map([
    ["Lang/en/main.json", { 你好: "Hello", 孤儿: "Ghost" }],
  ]);
  const small = new Map([["start", ["你好"]]]);

  it("默认保留孤儿键（含既有译文原样）；prune 开启才删除", () => {
    const kept = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: small,
      existing,
    })[0]!;
    expect(kept.entries).toEqual({ 你好: "Hello", 孤儿: "Ghost" });
    const pruned = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: small,
      existing,
      prune: true,
    })[0]!;
    expect(pruned.entries).toEqual({ 你好: "Hello" });
    expect(
      prunedOverlayKeys(
        Object.keys(pruned.entries),
        Object.keys(existing.get("Lang/en/main.json")!),
      ),
    ).toEqual(["孤儿"]);
  });

  it("幂等：连跑两次第二次逐字节零改动（含孤儿保留形态）", () => {
    const first = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: small,
      existing,
    });
    const again = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: small,
      existing: new Map(first.map((file) => [file.path, file.entries])),
    });
    expect(again.map((file) => file.content)).toEqual(
      first.map((file) => file.content),
    );
  });

  it("空串译文 = 命中语义：保留不占位；新键按 placeholder 占位", () => {
    const file = planOverlaySkeleton({
      lang: "en",
      layout: "main",
      storyKeys: new Map([["start", ["你好", "新句"]]]),
      existing: new Map([["Lang/en/main.json", { 你好: "" }]]),
      placeholder: "empty",
    })[0]!;
    expect(file.entries).toEqual({ 你好: "", 新句: "" });
  });
});

/* ———————————————— 合并视图（core 语义的消费端） ———————————————— */

describe("合并视图：main.json 兜底最先 + 路径码元序，后写胜", () => {
  it("供给序规范化与覆盖语义", () => {
    const view = mergeOverlayView([
      { path: "z.json", entries: { 键: "z" } },
      { path: "main.json", entries: { 键: "main", 兜底: "m" } },
      { path: "a.json", entries: { 键: "a" } },
    ]);
    expect(view.order).toEqual(["main.json", "a.json", "z.json"]);
    expect(view.entries.get("键")).toBe("z");
    expect(view.entries.get("兜底")).toBe("m");
    expect(view.keys).toEqual(["兜底", "键"].sort());
  });

  it("空输入：键集合为空（显式状态，不抛）", () => {
    const view = mergeOverlayView([]);
    expect(view.keys).toEqual([]);
    expect(view.order).toEqual([]);
  });
});

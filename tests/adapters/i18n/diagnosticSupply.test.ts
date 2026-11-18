/**
 * 诊断供给侧新增字段的判据：`overlayFilesByLang`（逐语言逐文件真实布局表）
 * 与 `layoutConflicts`（同语言内同键多文件异值）。旧字段语义零改动
 * （既有覆盖在 `tests/editor/diagnostic-supply.test.ts`）。
 *
 * 口径：坏文件跳过不进表；有效零键文件仍出现（空键集）；路径原样不归一
 * （单文件就是 `Lang/{lang}.json`）；冲突判定跨语言不比，语言码元序拼接。
 */
import { describe, expect, it } from "vitest";
import {
  createFileListFileSource,
  loadDiagnosticSupply,
} from "@lingfan-engine/adapters";

type Tree = { [name: string]: Tree | string };

/** 目录树 → `<input webkitdirectory>` 的文件表（首段 = 用户选中的目录名） */
function filesUnder(folder: string, tree: Tree): File[] {
  const out: File[] = [];
  const walk = (prefix: string, node: Tree): void => {
    for (const [name, value] of Object.entries(node)) {
      const path = `${prefix}/${name}`;
      if (typeof value === "string") {
        const file = new File([value], name);
        Object.defineProperty(file, "webkitRelativePath", { value: path });
        out.push(file);
      } else {
        walk(path, value);
      }
    }
  };
  walk(folder, tree);
  return out;
}

async function supplyOf(tree: Tree) {
  // 资源根锚点：root-locate 对「无 project.json 且无 Stories/」fail-closed，
  // 照既有 tests/editor/diagnostic-supply.test.ts 的夹具模式补最小清单
  const source = await createFileListFileSource(
    filesUnder("Resources", { "project.json": "{}", ...tree }),
  );
  return loadDiagnosticSupply(source);
}

describe("overlayFilesByLang（逐语言逐文件布局表）", () => {
  it("per-story 布局：每文件各自的键集，路径原样", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": {
          "main.json": '{"title":"标题"}',
          chapter: { "a.json": '{"a":"甲","b":"乙"}' },
        },
      },
    });
    const zh = supply.overlayFilesByLang?.get("zh-CN");
    expect(zh).toBeDefined();
    expect([...zh!.keys()]).toEqual([
      "Lang/zh-CN/chapter/a.json",
      "Lang/zh-CN/main.json",
    ]);
    expect([...zh!.get("Lang/zh-CN/main.json")!]).toEqual(["title"]);
    expect([...zh!.get("Lang/zh-CN/chapter/a.json")!].sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("单文件形态：路径就是 Lang/{lang}.json，语言取文件名", async () => {
    const supply = await supplyOf({
      Lang: { "en.json": '{"title":"Title"}' },
    });
    const en = supply.overlayFilesByLang?.get("en");
    expect([...en!.keys()]).toEqual(["Lang/en.json"]);
    expect([...en!.get("Lang/en.json")!]).toEqual(["title"]);
  });

  it("坏文件不进表；有效零键文件仍出现（空键集）", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": {
          "main.json": "{}",
          "bad.json": "{oops",
          "mixed.json": '{"k":1}',
        },
      },
    });
    const zh = supply.overlayFilesByLang?.get("zh-CN");
    expect([...zh!.keys()]).toEqual(["Lang/zh-CN/main.json"]);
    expect(zh!.get("Lang/zh-CN/main.json")!.size).toBe(0);
  });

  it("无 Lang/ ⇒ 空表（字段仍在，双轨消费方可判空）", async () => {
    const supply = await supplyOf({ "project.json": "{}" });
    expect(supply.overlayFilesByLang?.size).toBe(0);
    expect(supply.layoutConflicts).toEqual([]);
    expect(supply.unmarkedHostTexts).toBeUndefined();
  });
});

describe("layoutConflicts（同语言内同键多文件异值）", () => {
  it("同键 ≥2 文件且取值 ≥2 种才报；sites 按路径再按值码元序", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": {
          "main.json": '{"title":"总标题","same":"同"}',
          chapter: {
            "a.json": '{"title":"章标题","same":"同"}',
          },
        },
      },
    });
    expect(supply.layoutConflicts).toEqual([
      {
        key: "title",
        sites: [
          { path: "Lang/zh-CN/chapter/a.json", value: "章标题" },
          { path: "Lang/zh-CN/main.json", value: "总标题" },
        ],
      },
    ]);
  });

  it("跨语言不比：en 与 zh-CN 同键异值不算冲突", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": { "main.json": '{"title":"标题"}' },
        "en.json": '{"title":"Title"}',
      },
    });
    expect(supply.layoutConflicts).toEqual([]);
  });

  it("多语言各有冲突：语言码元序拼接，语言内键码元序", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": {
          "a.json": '{"z":"1","a":"1"}',
          "b.json": '{"z":"2","a":"2"}',
        },
        en: {
          "a.json": '{"k":"x"}',
          "b.json": '{"k":"y"}',
        },
      },
    });
    expect(supply.layoutConflicts?.map((c) => c.key)).toEqual(["k", "a", "z"]);
    expect(supply.layoutConflicts?.[0]?.sites[0]?.path).toBe("Lang/en/a.json");
    expect(supply.layoutConflicts?.[1]?.sites[0]?.path).toBe(
      "Lang/zh-CN/a.json",
    );
  });

  it("坏文件不参与冲突判定（整文件跳过）", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": {
          "main.json": '{"title":"标题"}',
          "bad.json": '{"title":"异值" oops',
        },
      },
    });
    expect(supply.layoutConflicts).toEqual([]);
  });

  it("同键同值多文件 ≠ 冲突（覆盖不是错）", async () => {
    const supply = await supplyOf({
      Lang: {
        "zh-CN": {
          "main.json": '{"k":"同"}',
          "a.json": '{"k":"同"}',
        },
      },
    });
    expect(supply.layoutConflicts).toEqual([]);
  });
});

/**
 * 叠加层合并规则的判据测试。
 *
 * 合并规则是生成器的核心语义：三条规则各自对应一类「骨架与叠加层该怎么共存」的
 * 判断。它们错了不会报错，只会让新工程里少一个依赖、多一个不该有的文件，
 * 而这些问题要到使用者第一次 `pnpm dev` 才暴露。
 *
 * 夹具写在 `tests/create/.tmp-overlay/` 下（vite fs.allow 白名单内，跑完即删）：
 * 合并规则的输入本来就是磁盘目录，用真实目录测才能覆盖 `listFiles` 的遍历与跳过。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  deepMerge,
  listFiles,
  mergeLayers,
  readLayer,
} from "../../packages/create/src/overlay/merge.ts";

const BASE = fileURLToPath(new URL("./.tmp-overlay/", import.meta.url));

afterEach(() => {
  rmSync(BASE, { recursive: true, force: true });
});

/** 造一层目录：键为相对路径，值为文本内容 */
function makeLayer(name: string, files: Record<string, string>): string {
  const root = join(BASE, name);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

describe("目录列举", () => {
  it("递归列出文件并按路径排序", () => {
    const root = makeLayer("list", {
      "b.ts": "b",
      "a/z.ts": "z",
      "a/y.ts": "y",
    });
    expect(listFiles(root)).toEqual(["a/y.ts", "a/z.ts", "b.ts"]);
  });

  it("跳过依赖与构建产物目录", () => {
    const root = makeLayer("skip", {
      "keep.ts": "k",
      "node_modules/x.ts": "x",
      "dist/y.ts": "y",
      "Saves/z.json": "z",
    });
    expect(listFiles(root)).toEqual(["keep.ts"]);
  });
});

describe("单层读取", () => {
  it("根目录的 patch 被解析成增量，不进文件表", () => {
    const root = makeLayer("patch", {
      "package.json": "{}",
      "package.patch.json": '{"dependencies":{"vue":"^3.5.0"}}',
    });
    const layer = readLayer(root);
    expect(layer.files.map((file) => file.path)).toEqual(["package.json"]);
    expect(layer.patch).toEqual({ dependencies: { vue: "^3.5.0" } });
  });

  it("嵌套目录的同名 patch 当普通文件保留", () => {
    const root = makeLayer("nested", {
      "sub/package.patch.json": '{"a":1}',
    });
    const layer = readLayer(root);
    expect(layer.files.map((file) => file.path)).toEqual([
      "sub/package.patch.json",
    ]);
    expect(layer.patch).toBeUndefined();
  });
});

describe("多层合并", () => {
  it("同路径后层覆盖前层", () => {
    const skeleton = makeLayer("m-skeleton", { "main.ts": "骨架" });
    const overlay = makeLayer("m-overlay", { "main.ts": "覆盖" });
    const merged = mergeLayers([skeleton, overlay]);
    expect(merged.files).toHaveLength(1);
    expect(String(merged.files[0]?.content)).toBe("覆盖");
  });

  it("不同路径都保留", () => {
    const skeleton = makeLayer("u-skeleton", { "main.ts": "a" });
    const overlay = makeLayer("u-overlay", { "App.vue": "b" });
    const merged = mergeLayers([skeleton, overlay]);
    // 顺序按首次出现的层与层内列举顺序：骨架在前，叠加层在后
    expect(merged.files.map((file) => file.path)).toEqual([
      "main.ts",
      "App.vue",
    ]);
  });

  it("各层增量逐层深合并", () => {
    const skeleton = makeLayer("p-skeleton", {
      "package.patch.json": '{"dependencies":{"core":"^0.1.0"}}',
    });
    const framework = makeLayer("p-framework", {
      "package.patch.json": '{"dependencies":{"vue":"^3.5.0"}}',
    });
    const shell = makeLayer("p-shell", {
      "package.patch.json": '{"devDependencies":{"tsx":"^4.20.0"}}',
    });
    const merged = mergeLayers([skeleton, framework, shell]);
    expect(merged.patch).toEqual({
      dependencies: { core: "^0.1.0", vue: "^3.5.0" },
      devDependencies: { tsx: "^4.20.0" },
    });
  });

  it("缺席的目录被跳过而不是报错", () => {
    const skeleton = makeLayer("a-skeleton", { "main.ts": "a" });
    const merged = mergeLayers([skeleton, join(BASE, "does-not-exist")]);
    expect(merged.files).toHaveLength(1);
    expect(merged.patch).toBeUndefined();
  });
});

describe("深合并语义", () => {
  it("普通对象逐键递归", () => {
    const merged = deepMerge(
      { exports: { ".": "./a.ts", "./b": "./b.ts" } },
      { exports: { ".": "./c.ts" } },
    );
    expect(merged).toEqual({ exports: { ".": "./c.ts", "./b": "./b.ts" } });
  });

  it("数组整体取代而非拼接", () => {
    const merged = deepMerge({ keywords: ["a", "b"] }, { keywords: ["c"] });
    expect(merged).toEqual({ keywords: ["c"] });
  });

  it("标量由后者取代", () => {
    expect(deepMerge({ version: "1.0.0" }, { version: "2.0.0" })).toEqual({
      version: "2.0.0",
    });
  });
});

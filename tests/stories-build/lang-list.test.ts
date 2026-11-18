/**
 * 语言清单（`virtual:lang-list`）的判据：扫描器、虚拟模块与 Node 装载垫片三层。
 *
 * 扫描器直接调 `scanLangRegistry`（tmp 目录 fixture）；虚拟模块直接调
 * `resolveId` / `load`（不启动构建，同 `tests/tools/template-story-list.test.ts`
 * 的口径）；垫片走真实 `host-plugins.mjs`（tsx 装载），验证显式转发清单没漏——
 * 漏一行转发，vite 配置里拿到的就是 undefined。
 */
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  LANG_LIST_MODULE_ID,
  langListVirtual,
  type DevServerLike,
} from "../../packages/stories-build/src/host-plugins/index.ts";
import { scanLangRegistry } from "../../packages/stories-build/src/lang-list/index.ts";

const TMP = fileURLToPath(new URL("./.tmp-lang-list/", import.meta.url));

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** 建 fixture：相对路径 → 文本（目录自动创建） */
function fixture(files: Record<string, string>): string {
  mkdirSync(TMP, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const path = join(TMP, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text, "utf8");
  }
  return TMP;
}

describe("scanLangRegistry（Lang/ 扫描器）", () => {
  it("目录形态：递归收集 .json/.json.enc，语言与文件均码元序", () => {
    const root = fixture({
      "zh-CN/main.json": "{}",
      "zh-CN/chapter/a.json": "{}",
      "zh-CN/secret.json.enc": "cipher",
      "en/b.json": "{}",
      "en/a.json": "{}",
    });
    expect(scanLangRegistry(root)).toEqual([
      { lang: "en", files: ["Lang/en/a.json", "Lang/en/b.json"] },
      {
        lang: "zh-CN",
        files: [
          "Lang/zh-CN/chapter/a.json",
          "Lang/zh-CN/main.json",
          "Lang/zh-CN/secret.json.enc",
        ],
      },
    ]);
  });

  it("单文件形态：Lang/{lang}.json；目录与同名单文件并存时目录优先", () => {
    const root = fixture({
      "en.json": "{}",
      "ja/main.json": "{}",
      "ja.json": "{}",
    });
    expect(scanLangRegistry(root)).toEqual([
      { lang: "en", files: ["Lang/en.json"] },
      { lang: "ja", files: ["Lang/ja/main.json"] },
    ]);
  });

  it("点文件/点目录跳过；非 overlay 扩展名不收", () => {
    const root = fixture({
      ".hidden/x.json": "{}",
      "en/.secret.json": "{}",
      "en/notes.txt": "x",
      "en/a.json": "{}",
    });
    expect(scanLangRegistry(root)).toEqual([
      { lang: "en", files: ["Lang/en/a.json"] },
    ]);
  });

  it("Lang/ 不存在 ⇒ 空清单（无多语言供给是合法形态）", () => {
    expect(scanLangRegistry(join(TMP, "absent"))).toEqual([]);
  });

  it("空语言目录仍出现在清单（files 空表，运行期按供给为空 fail-closed）", () => {
    const root = fixture({ "en/placeholder.txt": "x" });
    expect(scanLangRegistry(root)).toEqual([{ lang: "en", files: [] }]);
  });
});

/** 取插件对某个虚拟模块 id 的求值结果 */
function loadModule(moduleId: string, resourcesDir: string): string | null {
  const plugin = langListVirtual({ resourcesDir }, import.meta.url);
  const resolved = plugin.resolveId(moduleId);
  return resolved === null ? null : plugin.load(resolved);
}

describe("langListVirtual（虚拟模块）", () => {
  it("认得自己的 id，别的 id 一律不接管", () => {
    const plugin = langListVirtual({ resourcesDir: TMP }, import.meta.url);
    expect(plugin.resolveId(LANG_LIST_MODULE_ID)).toBe(
      `\0${LANG_LIST_MODULE_ID}`,
    );
    expect(plugin.resolveId("virtual:story-list")).toBeNull();
    expect(plugin.resolveId("./langs.ts")).toBeNull();
  });

  it("产出 export const LANGS = 扫描结果（JSON 可解析、码元序）", () => {
    const root = fixture({
      "Lang/en.json": "{}",
      "Lang/zh-CN/main.json": "{}",
    });
    const source = loadModule(LANG_LIST_MODULE_ID, root);
    expect(source).not.toBeNull();
    const json = /=\s*(\[.*\]);/s.exec(source!)?.[1];
    expect(JSON.parse(json!)).toEqual([
      { lang: "en", files: ["Lang/en.json"] },
      { lang: "zh-CN", files: ["Lang/zh-CN/main.json"] },
    ]);
  });

  it("Lang/ 不存在 ⇒ 空数组模块（import 不炸）", () => {
    mkdirSync(TMP, { recursive: true });
    const source = loadModule(LANG_LIST_MODULE_ID, TMP);
    expect(source).toBe("export const LANGS = [];");
  });

  it("dev 监听 Lang/：域内新增作废模块并整页刷新，域外不打扰", () => {
    const root = fixture({ "Lang/en.json": "{}" });
    const plugin = langListVirtual({ resourcesDir: root }, import.meta.url);
    const watcher = new EventEmitter() as EventEmitter & {
      add(paths: readonly string[]): void;
      added: string[];
    };
    watcher.added = [];
    watcher.add = (paths) => watcher.added.push(...paths);
    const invalidated: unknown[] = [];
    const reloads: unknown[] = [];
    const mod = { id: "mod" };
    const server = {
      watcher,
      moduleGraph: {
        getModuleById: () => mod,
        invalidateModule: (m: unknown) => invalidated.push(m),
      },
      ws: { send: (payload: unknown) => reloads.push(payload) },
    } as unknown as DevServerLike;
    plugin.configureServer?.(server);
    expect(watcher.added).toEqual([join(root, "Lang")]);
    watcher.emit("add", join(root, "Lang", "ja.json"));
    expect(invalidated).toEqual([mod]);
    expect(reloads).toEqual([{ type: "full-reload" }]);
    watcher.emit("unlink", join(root, "Stories", "x.json"));
    expect(invalidated.length).toBe(1); // 域外事件不作废不刷新
    expect(reloads.length).toBe(1);
  });
});

describe("host-plugins.mjs（Node 装载垫片）", () => {
  /** 动态装载真实垫片（.mjs 无声明文件，形状按本判据收窄；tsx 装载真实实现） */
  async function loadShim(): Promise<{
    LANG_LIST_MODULE_ID: string;
    langListVirtual: (
      options: { resourcesDir?: string },
      moduleUrl: string,
    ) => {
      resolveId(id: string): string | null;
      load(id: string): string | null;
    };
  }> {
    // 说明符经变量走运行期解析：.mjs 垫片无声明文件（types 条件只给包子路径），
    // 静态字面量会被 vue-tsc 按 TS7016 拦下；形状由下方断言收窄。
    const shimPath = "../../packages/stories-build/host-plugins.mjs";
    return (await import(shimPath)) as never;
  }

  it("显式转发清单含语言清单两件（漏转发 = vite 配置里 undefined）", async () => {
    const shim = await loadShim();
    expect(shim.LANG_LIST_MODULE_ID).toBe("virtual:lang-list");
    expect(typeof shim.langListVirtual).toBe("function");
  });

  it("垫片装载的实现与源码出口同一份（扫描逻辑只有一份）", async () => {
    const shim = await loadShim();
    const root = fixture({ "Lang/en.json": "{}" });
    const plugin = shim.langListVirtual(
      { resourcesDir: root },
      import.meta.url,
    );
    const resolved = plugin.resolveId("virtual:lang-list");
    expect(resolved).toBe("\0virtual:lang-list");
    expect(plugin.load(resolved!)).toBe(
      'export const LANGS = [{"lang":"en","files":["Lang/en.json"]}];',
    );
  });
});

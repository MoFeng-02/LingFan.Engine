/**
 * 模板清单虚拟模块的判据：故事清单与字体清单都必须来自磁盘事实。
 *
 * 这里验证的是「扫描得出什么」，不是「vite 能不能跑」——直接调插件的
 * `resolveId` / `load`，不启动构建。
 *
 * 为什么不放在 `tests/template`：那一域按约定禁 Node 导入（只用 `?raw` 读文本），
 * 而本判据要真的走一次目录遍历，属于工具域。
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  storyFontsVirtual,
  storyListVirtual,
} from "../../template/v1/__PROJECT__/vite.plugins.ts";

/** 取插件对某个虚拟模块 id 的求值结果（未命中时返回 null） */
function load(
  plugin: { resolveId?: unknown; load?: unknown },
  moduleId: string,
): string | null {
  const resolveId = plugin.resolveId as (id: string) => string | null;
  const loadFn = plugin.load as (id: string) => string | null;
  const resolved = resolveId(moduleId);
  if (resolved === null) return null;
  return loadFn(resolved);
}

/** 从 `export const X = [...];` 形态的模块源码里取回数组 */
function arrayOf(source: string | null): readonly string[] {
  expect(source, "虚拟模块未产出源码").not.toBeNull();
  const json = /=\s*(\[.*\]);/s.exec(source!)?.[1];
  expect(json, "虚拟模块源码里找不到数组字面量").toBeDefined();
  return JSON.parse(json!) as readonly string[];
}

describe("模板的故事清单来自磁盘扫描", () => {
  it("虚拟模块 id 认得出来，别的 id 一律不接管", () => {
    const plugin = storyListVirtual();
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId("virtual:story-list")).toBe("\0virtual:story-list");
    expect(resolveId("virtual:something-else")).toBeNull();
    expect(resolveId("./stories.ts")).toBeNull();
  });

  it("扫描结果就是资源根下的故事文件，路径相对资源根", () => {
    const stories = arrayOf(load(storyListVirtual(), "virtual:story-list"));
    expect(stories.length).toBeGreaterThan(0);
    // 骨架自带一列手写故事；路径形态是「Stories/<章节>/<文件>」
    expect(stories).toContain("Stories/title/title_main.story");
    for (const path of stories) {
      expect(path.startsWith("Stories/"), `${path} 不在 Stories/ 下`).toBe(
        true,
      );
      expect(path).toMatch(/\.(story|json)$/);
    }
  });

  it("顺序是路径码元序，与组装器的装载顺序同一条判据", () => {
    const stories = arrayOf(load(storyListVirtual(), "virtual:story-list"));
    expect([...stories].sort()).toEqual([...stories]);
  });

  it("只收故事文件：同目录下的其他扩展名不进来", () => {
    const stories = arrayOf(load(storyListVirtual(), "virtual:story-list"));
    for (const path of stories) {
      expect(path.endsWith(".json") || path.endsWith(".story")).toBe(true);
    }
  });
});

describe("模板的字体清单来自磁盘扫描", () => {
  it("虚拟模块 id 认得出来", () => {
    const plugin = storyFontsVirtual();
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId("virtual:story-fonts")).toBe("\0virtual:story-fonts");
    expect(resolveId("virtual:story-list")).toBeNull();
  });

  it("模板资源根里没有字体时给空表，不抛错", () => {
    const source = load(storyFontsVirtual(), "virtual:story-fonts");
    expect(source, "字体虚拟模块未产出源码").not.toBeNull();
    expect(source).toContain("export const storyFonts = [");
  });
});

/** 假 dev server：只提供 watcher 与整页刷新两条被插件用到的能力 */
function fakeServer(): {
  server: {
    watcher: EventEmitter & { add: (paths: readonly string[]) => void };
    moduleGraph: {
      getModuleById: (id: string) => object | undefined;
      invalidateModule: (mod: object) => void;
    };
    ws: { send: (payload: unknown) => void };
  };
  added: string[][];
  invalidated: string[];
  reloads: unknown[];
} {
  const watcher = Object.assign(new EventEmitter(), {
    add: (paths: readonly string[]): void => {
      added.push([...paths]);
    },
  });
  const added: string[][] = [];
  const invalidated: string[] = [];
  const reloads: unknown[] = [];
  return {
    added,
    invalidated,
    reloads,
    server: {
      watcher,
      moduleGraph: {
        getModuleById: () => ({ id: "\0virtual:story-list" }),
        invalidateModule: () => {
          invalidated.push("virtual:story-list");
        },
      },
      ws: {
        send: (payload: unknown) => {
          reloads.push(payload);
        },
      },
    },
  };
}

describe("模板清单在 dev 下跟着磁盘变", () => {
  it("监听资源根：新增或删除文件都作废清单并整页刷新", () => {
    const { server, added, invalidated, reloads } = fakeServer();
    const plugin = storyListVirtual();
    const configureServer = plugin.configureServer as (s: unknown) => void;
    configureServer(server);

    // 资源根目录本身进监听列表（否则新目录里的文件不会触发事件）
    const root = added.flat().find((p) => p.endsWith("Stories"));
    expect(root, "资源根没进监听列表").toBeDefined();

    server.watcher.emit("add", `${root}/title/new.story`);
    expect(invalidated).toEqual(["virtual:story-list"]);
    expect(reloads).toEqual([{ type: "full-reload" }]);
  });

  it("资源根之外的改动不打扰清单", () => {
    const { server, added, invalidated, reloads } = fakeServer();
    const configureServer = storyListVirtual().configureServer as (
      s: unknown,
    ) => void;
    configureServer(server);
    const root = added.flat().find((p) => p.endsWith("Stories"))!;

    server.watcher.emit("add", `${root}/../Audio/theme.mp3`);
    expect(invalidated).toEqual([]);
    expect(reloads).toEqual([]);
  });
});

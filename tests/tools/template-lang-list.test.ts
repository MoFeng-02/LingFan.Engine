/**
 * 模板语言清单虚拟模块的判据：清单必须来自磁盘事实，且骨架样例开箱可切语言。
 *
 * 与 `template-story-list.test.ts` 同构：直接调插件的 `resolveId` / `load`，
 * 不启动构建。放工具域的理由相同——要真的走一次目录遍历，`tests/template`
 * 按约定禁 Node 导入。
 *
 * 额外守一条「样例可跑」：骨架自带的 `Lang/en/` 必须把宿主玩家可见文案与
 * 两列故事的键都译齐——样例缺键时选择器切过去仍是中文，用户会以为接线坏了。
 */
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { langListVirtual } from "../../template/v1/__PROJECT__/vite.plugins.ts";

/** 语言清单条目：语言码 + 该语言的 overlay 文件表（相对资源根） */
interface LangEntry {
  readonly lang: string;
  readonly files: readonly string[];
}

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

/** 从 `export const LANGS = [...];` 形态的模块源码里取回清单 */
function langEntries(): readonly LangEntry[] {
  const source = load(langListVirtual(), "virtual:lang-list");
  expect(source, "语言虚拟模块未产出源码").not.toBeNull();
  const json = /=\s*(\[.*\]);/s.exec(source!)?.[1];
  expect(json, "虚拟模块源码里找不到数组字面量").toBeDefined();
  return JSON.parse(json!) as readonly LangEntry[];
}

describe("模板的语言清单来自磁盘扫描", () => {
  it("虚拟模块 id 认得出来，别的 id 一律不接管", () => {
    const plugin = langListVirtual();
    const resolveId = plugin.resolveId as (id: string) => string | null;
    expect(resolveId("virtual:lang-list")).toBe("\0virtual:lang-list");
    expect(resolveId("virtual:story-list")).toBeNull();
    expect(resolveId("./langs.ts")).toBeNull();
  });

  it("骨架自带 en 样例：目录形态，文件表相对资源根且全在 Lang/en/ 下", () => {
    const entries = langEntries();
    const en = entries.find((entry) => entry.lang === "en");
    expect(en, "骨架缺 Lang/en/ 样例").toBeDefined();
    expect(en!.files.length).toBeGreaterThan(0);
    for (const path of en!.files) {
      expect(path.startsWith("Lang/en/"), `${path} 不在 Lang/en/ 下`).toBe(
        true,
      );
      expect(path).toMatch(/\.(json|json\.enc)$/);
    }
    // 文件表按码元序：与供给端（adapters）的取件顺序同一条判据
    expect([...en!.files].sort()).toEqual([...en!.files]);
  });

  it("语言码按码元序排列", () => {
    const langs = langEntries().map((entry) => entry.lang);
    expect([...langs].sort()).toEqual([...langs]);
  });

  it("只收译文文件：点文件与别的扩展名不进来", () => {
    for (const entry of langEntries()) {
      for (const path of entry.files) {
        expect(path.endsWith(".json") || path.endsWith(".json.enc")).toBe(true);
        expect(path.split("/").some((seg) => seg.startsWith("."))).toBe(false);
      }
    }
  });
});

describe("骨架 en 样例把玩家可见文案译齐（装完即可切语言）", () => {
  const LANG_ROOT = new URL(
    "../../template/v1/__PROJECT__/Resources/Lang/en/",
    import.meta.url,
  );

  /** 读样例里的一个 overlay 文件（键 = 原文整句） */
  function overlay(relative: string): Record<string, string> {
    const text = readFileSync(
      fileURLToPath(new URL(relative, LANG_ROOT)),
      "utf8",
    );
    return JSON.parse(text) as Record<string, string>;
  }

  it("宿主通用文案（对话视图/存读档 toast/工具栏）在 host/main.json", () => {
    const keys = Object.keys(overlay("host/main.json"));
    for (const key of [
      "确定",
      "视频播放中……（点击或空格跳过）",
      "等待中……（点击或空格跳过）",
      "已保存到",
      "已读取",
      "存档",
      "存",
      "读",
      "加载中……",
    ]) {
      expect(keys, `host/main.json 缺键「${key}」`).toContain(key);
    }
  });

  it("小程序存读档条的文案也在兜底层（SaveLoadBar 不在 src/host 下）", () => {
    const keys = Object.keys(overlay("host/main.json"));
    for (const key of ["关闭", "写入存档", "读取存档", "空槽", "已有存档"]) {
      expect(keys, `host/main.json 缺键「${key}」`).toContain(key);
    }
  });

  it("面板文案按路径镜像落 host/panels/*.json", () => {
    const history = Object.keys(overlay("host/panels/history.json"));
    expect(history).toContain("历史");
    expect(history).toContain("关闭历史");
    const prefs = Object.keys(overlay("host/panels/preferences.json"));
    for (const key of ["音效", "环境", "语音", "静音", "文字速度", "字/秒"]) {
      expect(prefs, `preferences.json 缺键「${key}」`).toContain(key);
    }
  });

  it("两列骨架故事的台词与菜单都有译文（切过去故事也是英文）", () => {
    const title = overlay("title/title_main.json");
    for (const key of [
      "这是用 TypeScript 写的故事列。",
      "旁白",
      "改完保存，在工程根跑 pnpm stories:build 就会重新生成故事文件。",
      "接下来做什么？",
      "四处看看",
      "重来一次",
    ]) {
      expect(Object.keys(title), `title_main.json 缺键「${key}」`).toContain(
        key,
      );
    }
    const around = Object.keys(overlay("title/look_around.json"));
    expect(around).toContain("你绕着走了一圈，什么也没发生。");
    expect(around).toContain(
      "想加点东西，就打开 Stories.src/title/look_around.ts 改写这一列。",
    );
  });

  it("样例值都是非空字符串（坏值会被供给端整文件跳过）", () => {
    for (const relative of [
      "host/main.json",
      "host/panels/history.json",
      "host/panels/preferences.json",
      "title/title_main.json",
      "title/look_around.json",
    ]) {
      for (const [key, value] of Object.entries(overlay(relative))) {
        expect(typeof value, `${relative} 的「${key}」`).toBe("string");
        expect(value.length, `${relative} 的「${key}」`).toBeGreaterThan(0);
      }
    }
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
        getModuleById: () => ({ id: "\0virtual:lang-list" }),
        invalidateModule: () => {
          invalidated.push("virtual:lang-list");
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

describe("语言清单在 dev 下跟着磁盘变", () => {
  it("监听 Lang/ 目录：新增或删除译文都作废清单并整页刷新", () => {
    const { server, added, invalidated, reloads } = fakeServer();
    const plugin = langListVirtual();
    const configureServer = plugin.configureServer as (s: unknown) => void;
    configureServer(server);

    const root = added.flat().find((p) => p.endsWith("Lang"));
    expect(root, "Lang/ 目录没进监听列表").toBeDefined();

    server.watcher.emit("add", `${root}/ja/main.json`);
    expect(invalidated).toEqual(["virtual:lang-list"]);
    expect(reloads).toEqual([{ type: "full-reload" }]);
  });

  it("Lang/ 之外的改动不打扰清单", () => {
    const { server, added, invalidated, reloads } = fakeServer();
    const configureServer = langListVirtual().configureServer as (
      s: unknown,
    ) => void;
    configureServer(server);
    const root = added.flat().find((p) => p.endsWith("Lang"))!;

    server.watcher.emit("add", `${root}/../Audio/theme.mp3`);
    expect(invalidated).toEqual([]);
    expect(reloads).toEqual([]);
  });
});

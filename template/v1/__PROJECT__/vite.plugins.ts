/**
 * 构建期的两个虚拟模块：字体清单与故事清单。
 *
 * 两个清单都是**磁盘事实的投影**，不是需要作者维护的声明文件：
 * - 字体清单 = `Resources/Fonts/` 下的字体文件名；
 * - 故事清单 = `Resources/Stories/` 递归得到的故事文件路径。
 *
 * 让作者手抄名单的代价不是「多写一行」，而是**漏抄时构建期毫无察觉**：
 * 漏登记的那一列要到运行期才以 `unknown-column` 现形。所以清单由扫描得出。
 *
 * 骨架与各框架层共用这一份实现：层只替换 `vite.config.ts` 的插件数组，
 * 扫描规则一处维护。
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** 字体文件扩展名集合（与 stories-build 的字体名注册表同口径） */
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"] as const;

/** 故事文件扩展名：手写文本形态 `.story` 与编译产物 `.json` 都算 */
const STORY_EXTENSIONS = [".story", ".json"] as const;

/** 字体清单条目：file = 资源文件名，name = 字体名（文件名去扩展名） */
export interface StoryFontEntry {
  file: string;
  name: string;
}

/** Resources/Fonts 扫描：点文件与未知扩展名跳过，文件名字典序稳定 */
function scanFonts(fontsDir: string): readonly StoryFontEntry[] {
  if (!existsSync(fontsDir)) return [];
  return readdirSync(fontsDir)
    .filter((file) => {
      const dot = file.lastIndexOf(".");
      return (
        dot > 0 &&
        (FONT_EXTENSIONS as readonly string[]).includes(
          file.slice(dot).toLowerCase(),
        )
      );
    })
    .sort()
    .map((file) => ({ file, name: file.slice(0, file.lastIndexOf(".")) }));
}

/**
 * Resources/Stories 递归扫描：返回相对资源根的逻辑路径（`Stories/<章节>/<文件>`）。
 *
 * 顺序 = 路径码元序，与引擎组装器的装载顺序同一条判据（`byPath`）——
 * 列序因此与磁盘布局一致，不随目录读取顺序漂移。
 */
function scanStories(storiesDir: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
        continue;
      }
      const dot = entry.name.lastIndexOf(".");
      if (dot <= 0) continue;
      if (
        (STORY_EXTENSIONS as readonly string[]).includes(
          entry.name.slice(dot).toLowerCase(),
        )
      ) {
        out.push(rel);
      }
    }
  };
  if (existsSync(storiesDir)) walk(storiesDir, "Stories");
  return out.sort();
}

/**
 * 造一个只提供固定值的虚拟模块插件。
 *
 * `watch` 里的目录在 dev 下被监听：新增或删除文件时把本模块作废并整页刷新，
 * 这样「放一个故事文件进去」在 dev 里立即生效，不必重启 dev server。
 */
function virtualModule(
  name: string,
  moduleId: string,
  build: () => string,
  watch: readonly string[],
): Plugin {
  const resolved = `\0${moduleId}`;
  return {
    name,
    resolveId(id) {
      return id === moduleId ? resolved : null;
    },
    load(id) {
      return id === resolved ? build() : null;
    },
    configureServer(server) {
      const roots = watch.map((dir) => resolve(dir).replace(/\\/g, "/"));
      server.watcher.add([...watch]);
      const onChange = (file: string): void => {
        const path = resolve(file).replace(/\\/g, "/");
        if (!roots.some((root) => path.startsWith(`${root}/`))) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

/**
 * 字体清单虚拟模块：构建期扫描 Resources/Fonts 产出字体名清单，
 * 宿主据此注入 @font-face 与项目默认字体——字体名注册表与 stories:build 同源，
 * 零新增依赖（脚手架工程保持可独立安装）。
 */
export function storyFontsVirtual(): Plugin {
  const fontsDir = fileURLToPath(new URL("./Resources/Fonts", import.meta.url));
  return virtualModule(
    "story-fonts",
    "virtual:story-fonts",
    () => `export const storyFonts = ${JSON.stringify(scanFonts(fontsDir))};`,
    [fontsDir],
  );
}

/**
 * 故事清单虚拟模块：构建期扫描 `Resources/Stories/` 得出要装载的故事文件表。
 *
 * 与字体清单同一手法：清单是磁盘事实，不是作者输入。TS 创作链的产物
 * （`Stories.src/` 编译出的 `.json`）与手写 `.story` 落在同一棵树，共用这一条扫描。
 */
export function storyListVirtual(): Plugin {
  const storiesDir = fileURLToPath(
    new URL("./Resources/Stories", import.meta.url),
  );
  return virtualModule(
    "story-list",
    "virtual:story-list",
    () => `export const STORIES = ${JSON.stringify(scanStories(storiesDir))};`,
    [storiesDir],
  );
}

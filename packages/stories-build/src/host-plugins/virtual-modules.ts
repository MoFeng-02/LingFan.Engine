/**
 * 宿主构建期的清单虚拟模块：字体清单与故事清单。
 *
 * 两个清单都是**磁盘事实的投影**，不是需要作者维护的声明文件。让作者手抄名单的代价
 * 不是「多写一行」，而是漏抄时构建期毫无察觉——漏登记的那一列要到运行期才以
 * `unknown-column` 现形。
 *
 * 资源根与故事目录名都取 `@lingfan-engine/core` 的一处声明（`RESOURCES_DIR` /
 * `STORIES_DIR`），且都可由调用方覆盖：工程把资源根搬到别处时改配置，不改扫描逻辑。
 *
 * 本模块只依赖 `node:*` 与引擎常量，**不 import vite**——插件对象按结构类型返回，
 * 宿主自带的 vite 版本决定实际类型，这里不引入版本约束。
 */
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { RESOURCES_DIR, STORIES_DIR } from "@lingfan-engine/core";
import { scanFontRegistry } from "../fonts/font-registry.ts";
import { scanStoryRegistry } from "../story-list/story-registry.ts";

/** 虚拟模块 id：字体清单 */
export const STORY_FONTS_MODULE_ID = "virtual:story-fonts";
/** 虚拟模块 id：故事清单 */
export const STORY_LIST_MODULE_ID = "virtual:story-list";

/** 宿主构建插件的最小结构面（vite 的 `Plugin` 与其它打包器同名成员兼容） */
export interface HostPlugin {
  readonly name: string;
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
  readonly configureServer?: (server: DevServerLike) => void;
}

/** dev server 的最小结构面：只用到「加监听目录、作废模块、整页刷新」三件事 */
export interface DevServerLike {
  readonly watcher: {
    add: (paths: readonly string[]) => void;
    on: (event: "add" | "unlink", listener: (file: string) => void) => void;
  };
  readonly moduleGraph: {
    getModuleById: (id: string) => unknown;
    invalidateModule: (mod: unknown) => void;
  };
  readonly ws: { send: (payload: { type: "full-reload" }) => void };
}

/** 资源根定位选项 */
export interface ResourceRootOptions {
  /**
   * 资源根目录的绝对路径；缺省 = 调用方所在模块同级的 `<RESOURCES_DIR>`。
   *
   * 给绝对路径就完全由调用方决定资源根落在哪里——扫描不假设工程布局。
   */
  readonly resourcesDir?: string;
}

/** 缺省资源根：与调用方模块同级的 `<RESOURCES_DIR>`（模板/宿主的常规布局） */
function defaultResourcesDir(moduleUrl: string): string {
  return fileURLToPath(new URL(`./${RESOURCES_DIR}`, moduleUrl));
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
): HostPlugin {
  const resolved = `\0${moduleId}`;
  return {
    name,
    resolveId: (id) => (id === moduleId ? resolved : null),
    load: (id) => (id === resolved ? build() : null),
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
 * 字体清单虚拟模块：扫描资源根下的字体目录产出字体名清单，
 * 宿主据此注入 @font-face 与项目默认字体——与 `stories:build` 的字体名注册表同源。
 *
 * @param options 资源根覆盖；缺省取调用方模块同级的 `<RESOURCES_DIR>`
 * @param moduleUrl 调用方模块的 `import.meta.url`（决定缺省资源根位置）
 */
export function storyFontsVirtual(
  options: ResourceRootOptions = {},
  moduleUrl: string,
): HostPlugin {
  const resourcesDir = options.resourcesDir ?? defaultResourcesDir(moduleUrl);
  const fontsDir = join(resourcesDir, "Fonts");
  return virtualModule(
    "story-fonts",
    STORY_FONTS_MODULE_ID,
    () =>
      `export const storyFonts = ${JSON.stringify(scanFontRegistry(fontsDir))};`,
    [fontsDir],
  );
}

/**
 * 故事清单虚拟模块：扫描资源根下的故事目录得出要装载的故事文件表。
 *
 * TS 创作链的产物（`Stories.src/` 编译出的 `.json`）与手写 `.story` 落在同一棵树，
 * 共用这一条扫描——创作形态不改变清单的来源。
 *
 * @param options 资源根覆盖；缺省取调用方模块同级的 `<RESOURCES_DIR>`
 * @param moduleUrl 调用方模块的 `import.meta.url`（决定缺省资源根位置）
 */
export function storyListVirtual(
  options: ResourceRootOptions = {},
  moduleUrl: string,
): HostPlugin {
  const resourcesDir = options.resourcesDir ?? defaultResourcesDir(moduleUrl);
  const storiesDir = join(resourcesDir, STORIES_DIR);
  return virtualModule(
    "story-list",
    STORY_LIST_MODULE_ID,
    () =>
      `export const STORIES = ${JSON.stringify(scanStoryRegistry(storiesDir))};`,
    [storiesDir],
  );
}

/**
 * 宿主构建插件必须能被各版本 vite 收下（类型面判据，编译期生效）。
 *
 * 判据的由来：模板同时供给浏览器壳（vite 8）、Tauri 壳（vite 8）与小程序壳（vite 5，
 * `@dcloudio/vite-plugin-uni` 的 peer 钉死 5.2.8）。插件的 `configureServer` 一旦写成
 * **函数属性**，`strictFunctionTypes` 就按参数逆变检查：vite 5 的
 * `invalidateModule(mod: ModuleNode, seen?, timestamp?, isHmr?)` 判不成
 * `(mod: unknown) => void`，`HostPlugin` 于是进不了 vite 5 的 `plugins` 数组。
 * 表现是消费方 `pnpm typecheck` 报 TS2769，而本仓门禁全绿——因为叠加层不进本仓
 * 类型检查（`tsconfig.json` 的 `exclude` 含 `template` 下的 `overlays` 通配）。
 *
 * 写成**方法签名**按双变处理，同一份结构面就同时兼容 5 与 8。本文件把这件事钉住：
 * 下面用两个「形状取自真实 vite」的替身类型做赋值判定，改回属性写法即编译失败。
 *
 * 替身刻意保留真实签名里的可选参数——正是那几个参数让逆变判定失败的。
 */
import { describe, expect, it } from "vitest";
// 从包内路径取：`./host-plugins` 子路径的运行时落点是 tsx 垫片，判据要的是类型与工厂本身
import type {
  DevServerLike,
  HostPlugin,
} from "../../packages/stories-build/src/host-plugins/index.ts";
import { storyListVirtual } from "../../packages/stories-build/src/host-plugins/index.ts";

/** vite 5 的 `ModuleNode` 形状（只取判定用到的成员） */
interface ModuleNodeLike {
  readonly id: string | null;
  readonly url: string;
}

/**
 * vite 5 的 `ViteDevServer` 形状：`invalidateModule` 带三个可选参数。
 *
 * 成员一律方法签名，与 vite 自己的声明方式一致——它也是靠这一点在
 * `strictFunctionTypes` 下保持可赋值。
 */
interface Vite5ServerLike {
  readonly watcher: {
    add(paths: readonly string[]): void;
    on(event: "add" | "unlink", listener: (file: string) => void): void;
  };
  readonly moduleGraph: {
    getModuleById(id: string): ModuleNodeLike | undefined;
    invalidateModule(
      mod: ModuleNodeLike,
      seen?: Set<ModuleNodeLike>,
      timestamp?: number,
      isHmr?: boolean,
    ): void;
  };
  readonly ws: { send(payload: { type: "full-reload" }): void };
}

/** vite 5 的 `Plugin` 里与本判据相关的那部分 */
interface Vite5PluginLike {
  readonly name: string;
  configureServer?(server: Vite5ServerLike): void;
}

/** vite 8 的 dev server 形状：`invalidateModule` 只收一个参数 */
interface Vite8ServerLike {
  readonly watcher: {
    add(paths: readonly string[]): void;
    on(event: "add" | "unlink", listener: (file: string) => void): void;
  };
  readonly moduleGraph: {
    getModuleById(id: string): ModuleNodeLike | undefined;
    invalidateModule(mod: ModuleNodeLike): void;
  };
  readonly ws: { send(payload: { type: "full-reload" }): void };
}

/** vite 8 的 `Plugin` 里与本判据相关的那部分 */
interface Vite8PluginLike {
  readonly name: string;
  configureServer?(server: Vite8ServerLike): void;
}

/**
 * 编译期判定：同一个插件值要能同时赋给两个版本的插件形状。
 *
 * 这两行没有任何运行时效果，它们的作用是「改坏了就编不过」——本仓门禁含
 * `vue-tsc --noEmit`，所以这是一条真的闸门，不是注释。
 */
const acceptVite5: (plugin: Vite5PluginLike) => Vite5PluginLike = (plugin) =>
  plugin;
const acceptVite8: (plugin: Vite8PluginLike) => Vite8PluginLike = (plugin) =>
  plugin;

/** 取一个真实插件值（工厂的返回类型就是 `HostPlugin`） */
function samplePlugin(): HostPlugin {
  return storyListVirtual({ resourcesDir: "." }, import.meta.url);
}

describe("宿主构建插件的类型面", () => {
  it("能赋给 vite 5 的插件形状（小程序壳）", () => {
    const plugin = samplePlugin();
    expect(() => acceptVite5(plugin)).not.toThrow();
    expect(plugin.name.length).toBeGreaterThan(0);
  });

  it("能赋给 vite 8 的插件形状（浏览器 / Tauri 壳）", () => {
    const plugin = samplePlugin();
    expect(() => acceptVite8(plugin)).not.toThrow();
    expect(typeof plugin.resolveId).toBe("function");
  });

  it("DevServerLike 的成员是方法签名，不是函数属性", () => {
    /**
     * 这条是给「有人把它改回 `成员: (…) => void`」准备的兜底说明——真正的拦截
     * 在上面两条赋值判定里（编译期）。这里只在运行期确认结构面没退化：方法调用
     * 与函数属性调用在运行期没有区别，所以只验成员齐全。
     */
    const server: DevServerLike = {
      watcher: { add: () => undefined, on: () => undefined },
      moduleGraph: {
        getModuleById: () => undefined,
        invalidateModule: () => undefined,
      },
      ws: { send: () => undefined },
    };
    expect(Object.keys(server).sort()).toEqual([
      "moduleGraph",
      "watcher",
      "ws",
    ]);
    expect(Object.keys(server.moduleGraph).sort()).toEqual([
      "getModuleById",
      "invalidateModule",
    ]);
  });
});

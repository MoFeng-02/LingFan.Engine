/**
 * 原生宿主端口：让同一份工程既能跑在浏览器里，也能被桌面壳加载。
 *
 * 为什么判定放在这里而不是壳层：`tauri` 叠加层只补 `src-tauri/` 与清单补丁，
 * 页面结构与组合根永远归属框架层。若壳层自己带一份组合根，`vue`/`react` 形态的
 * 页面节点就不再与那份组合根同源。所以「是否需要原生端口」由运行时事实判定，
 * 各形态的组合根都调同一个函数。
 *
 * 为什么用运行时判定：`tauri dev` 时页面可能被外部浏览器打开，构建期开关会判错。
 * `__TAURI_INTERNALS__` 只由真实 WebView 注入，是此刻唯一可靠的事实。
 *
 * 为什么模块名写在这里：打包器按字面量说明符静态解析（所以本工程必须声明
 * `@tauri-apps/api`），而适配器包不出现该模块名，浏览器与小程序形态才能在
 * 没有它时也装得上。非壳形态直接返回 `undefined`，动态导入一次都不会发生。
 */
import {
  createTauriSavePort,
  type TauriInvoke,
} from "@lingfan-engine/adapters";
import type { BootPortOverrides } from "./boot";

/** 当前页面是否由桌面壳加载（只有真实 WebView 会注入 `__TAURI_INTERNALS__`） */
export function isTauriHosted(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * 惰性 invoke：首次真正调用存档命令时才装载 `@tauri-apps/api/core`。
 *
 * 不在启动路径上 await 是刻意的——存档端口是同步构造的，而装载要等模块解析；
 * 把等待推迟到第一次读写，启动时序与浏览器形态完全一致。装载失败会原样抛给
 * 调用方，由存档流程的既有错误处理呈现，不会变成静默失败。
 */
function createLazyInvoke(): TauriInvoke {
  let loading: Promise<TauriInvoke> | undefined;
  return async (command, args) => {
    loading ??= import("@tauri-apps/api/core").then((module) => {
      const loaded: TauriInvoke = (name, payload) =>
        module.invoke(name, payload);
      return loaded;
    });
    const invoke = await loading;
    return invoke(command, args);
  };
}

/**
 * 按运行时事实给出端口覆盖；非桌面壳形态返回 `undefined`。
 *
 * 现在只换存档（`localStorage` 落在 WebView 数据目录，清缓存、换账户、重装都会
 * 带走存档）。其余端口沿用 `bootHost` 的 Web 缺省实现，随需要再加。
 */
export function createNativePorts(): BootPortOverrides | undefined {
  if (!isTauriHosted()) return undefined;
  return { saves: createTauriSavePort(createLazyInvoke()) };
}

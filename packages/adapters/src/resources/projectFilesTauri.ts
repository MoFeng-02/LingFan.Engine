/**
 * 工程供给（Tauri Desktop/Mobile 原生实现）：实现 `ProjectFilesPort` 契约——
 * 经 invoke 调 Rust `project_files` 命令（资源根 = `$RESOURCE/Resources`，dev/prod 同路径），
 * 命令一次返回清单 + 故事原始文本；本侧只做编组与 Record → Map 转换。
 *
 * invoke 与 listen 可注入（缺省取 Tauri 桥接域的缺省实现）：组合根无需注入，
 * 测试以契约替身注入（不依赖 Tauri 运行时，两侧各测一半的边界即在此）。
 * 装载结果 memo：manifest()/stories() 共享一次 invoke；失败粘滞（boot fail-closed，无重试路径）。
 * 热重载以重建端口实现，未来增补刷新语义走契约增补。
 */
import type { ProjectFilesPort } from "@lingfan/engine";
import {
  defaultInvoke,
  defaultListen,
  type TauriInvoke,
  type TauriListen,
} from "../platform";

/** Rust `project_files` 命令负载：清单对象 + 逻辑路径 → 故事原始文本 */
export interface TauriProjectFiles {
  manifest: unknown;
  stories: Record<string, string>;
}

/**
 * 造一个工程供给端口（桌面/移动原生）：调 Rust `project_files` 一次取回清单与全部故事原文。
 * 结果 memo 一次，`manifest()` 与 `stories()` 共享同一次调用；失败会一直复现（启动期 fail-closed，
 * 不重试也不给空工程）。热重载由组合根重建端口实现，不走本端口。
 */
export function createTauriProjectFilesPort(
  invoke: TauriInvoke = defaultInvoke,
): ProjectFilesPort {
  let loaded: Promise<TauriProjectFiles> | null = null;
  const load = (): Promise<TauriProjectFiles> => {
    loaded ??= invoke<TauriProjectFiles>("project_files");
    return loaded;
  };
  return {
    async manifest(): Promise<unknown> {
      return (await load()).manifest;
    },
    async stories(): Promise<Map<string, string>> {
      return new Map(Object.entries((await load()).stories));
    },
  };
}

// —— 热重载监视（dev 工具）——

/** 热重载停止句柄：退订事件监听（监视线程与 watcher 随进程生命周期，无需显式停） */
export interface StoryWatcher {
  stop(): void;
}

/**
 * 订阅工程文件热重载：Rust 递归监视源资源根（防抖）→ `story-changed` 事件
 * → onChange 回调（组合根重新供给+组装 → 引擎 reloadStory）。
 * listen/invoke 可注入（契约替身，测试不依赖 Tauri 运行时）；重复调用共享同一 Rust 监视（幂等）。
 */
export async function watchTauriProjectFiles(
  onChange: () => void,
  listen: TauriListen = defaultListen,
  invoke: TauriInvoke = defaultInvoke,
): Promise<StoryWatcher> {
  const unlisten = await listen("story-changed", onChange);
  await invoke("watch_project_files");
  return { stop: () => void unlisten() };
}

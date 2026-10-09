/**
 * 宿主端口适配器：宿主事实由组合根供值（Tauri = `host_platform` Rust 命令返回的
 * `std::env::consts::OS`；浏览器形态 = undefined），适配器只做**解析缓存与只读收敛**——
 * 宿主事实在进程生命周期内不变。
 *
 * 问 Rust 走 Tauri 桥接域的缺省实现，本文件不直连 Tauri 运行时。
 */
import { resolveHost } from "@lingfan/engine";
import type { HostInfo, HostPort } from "@lingfan/engine";
import { defaultInvoke } from "../platform";

/** 宿主端口的供值：组合根把「编译目标平台」交进来，适配器只负责解析与缓存 */
export interface HostPortOptions {
  /** 编译目标平台（缺省 = 浏览器/无壳形态 → unknown·desktop，显式未知不猜） */
  platform: string | undefined;
}

/**
 * 造一个宿主端口：首次 `get()` 解析出结果后缓存，之后一直复用同一份。
 * 宿主事实在进程生命周期内不变，因此无需失效逻辑。
 */
export function createHostPort(options: HostPortOptions): HostPort {
  let cached: HostInfo | undefined;
  return {
    get(): HostInfo {
      cached ??= resolveHost(options.platform);
      return cached;
    },
  };
}

/**
 * Tauri 形态的供数读取器：问 Rust 拿编译目标平台（不依赖编译期环境变量——它不会被注入）。
 * 非 Tauri 形态下取不到（模块缺失或命令不存在）即降级为 undefined，交由组合根按无壳形态处理。
 */
export async function readTauriPlatform(): Promise<string | undefined> {
  try {
    return await defaultInvoke<string>("host_platform");
  } catch {
    return undefined;
  }
}

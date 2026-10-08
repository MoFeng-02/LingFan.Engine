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

export interface HostPortOptions {
  /** 编译目标平台（缺省 = 浏览器/无壳形态 → unknown·desktop，显式未知不猜） */
  platform: string | undefined;
}

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

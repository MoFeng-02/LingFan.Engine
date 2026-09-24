/**
 * 05 §二 资源加密 ResourcePort 原生实现（⑨-4c 流式形态）：逻辑路径 → Rust
 * `decrypt_resource`（解密到 app data 临时流缓存，同资源幂等复用）→ 返回
 * `{"file":"<hex64.ext>"}` → `convertFileSrc(file, "lfstream")` 构造自定义协议 URL。
 * lfstream 协议（Rust 注册）带 Range/206——video/audio seek 流式，大资源（4K 500MB 级）
 * 不再受 IPC 32MB 护栏限制；Content-Type 由协议响应携带。
 *
 * 旧「IPC 全量字节 + Blob revoke」形态废弃：短生命周期语义改为「缓存随应用启动清理，
 * 进程内同资源幂等复用」（解密结果的明文只存在于受管临时目录，§一威胁模型不降级）。
 * 契约不变（resolve/release）；invoke 与 URL 构造均可注入（契约替身测试不依赖 Tauri 运行时）。
 */
import type { ResourcePort } from "@lingfan/engine";
import type { TauriInvoke } from "./projectFilesTauri";

const defaultInvoke: TauriInvoke = async <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
};

/** convertFileSrc 生成跨平台自定义协议 URL（Windows/Linux = http://lfstream.localhost/…） */
const defaultToStreamUrl = async (file: string): Promise<string> => {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(file, "lfstream");
};

interface StreamPayload {
  file: string;
}

export function createTauriEncryptedResourcePort(
  invoke: TauriInvoke = defaultInvoke,
  toStreamUrl: (file: string) => Promise<string> = defaultToStreamUrl,
): ResourcePort {
  return {
    async resolve(id: string): Promise<string> {
      // 解密失败必须抛错（K6 fail-closed，不静默返回坏 URL）；路径信任边界在 Rust 侧二次校验
      const raw = await invoke<string>("decrypt_resource", { path: id });
      let payload: StreamPayload;
      try {
        payload = JSON.parse(raw) as StreamPayload;
      } catch {
        throw new Error(`decrypt_resource 负载异常（非 JSON）：${raw.slice(0, 64)}`);
      }
      if (typeof payload?.file !== "string" || payload.file === "") {
        throw new Error("decrypt_resource 负载缺 file 字段");
      }
      return toStreamUrl(payload.file);
    },
    release(): void {
      // 临时流缓存生命周期归 Rust（应用启动清理）：URL 非 blob 形态，无需 revoke
    },
  };
}

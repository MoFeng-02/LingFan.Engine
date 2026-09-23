/**
 * 05 §二 资源加密 ResourcePort 原生实现：逻辑路径 → Rust `decrypt_resource`
 * （LFEN2/LFEN 解密，`tauri::ipc::Response` 原始字节通道）→ Blob + createObjectURL。
 * 短生命周期（§一威胁模型：解密资源仅以 Blob URL 存在，用后 revoke，无法批量落盘）；
 * 契约不变（resolve/release），组合根按清单 `resourceEncryption` 装配。
 *
 * invoke 可注入（契约替身，测试不依赖 Tauri 运行时）；返回字节兼容
 * ArrayBuffer / Uint8Array / number[]（`tauri::ipc::Response` 的 JS 形态跨版本稳妥处理）。
 * MIME 由扩展名映射（媒体元素对无类型 Blob 的嗅探不可靠）。
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

const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function mimeFor(id: string): string {
  const dot = id.lastIndexOf(".");
  const ext = dot >= 0 ? id.slice(dot + 1).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function toBytes(
  payload: ArrayBuffer | Uint8Array | number[],
): Uint8Array<ArrayBuffer> {
  if (payload instanceof Uint8Array) return new Uint8Array(payload); // 拷贝归一（BlobPart 类型边界）
  return new Uint8Array(payload);
}

export function createTauriEncryptedResourcePort(
  invoke: TauriInvoke = defaultInvoke,
): ResourcePort {
  return {
    async resolve(id: string): Promise<string> {
      // 解密失败必须抛错（K6 fail-closed，不静默返回坏 URL）；路径信任边界在 Rust 侧二次校验
      const payload = await invoke<ArrayBuffer | Uint8Array | number[]>(
        "decrypt_resource",
        { path: id },
      );
      const blob = new Blob([toBytes(payload)], { type: mimeFor(id) });
      return URL.createObjectURL(blob);
    },
    release(url: string): void {
      // Blob 短生命周期：用后 revoke（§一「运行时抓资源」防线）
      URL.revokeObjectURL(url);
    },
  };
}

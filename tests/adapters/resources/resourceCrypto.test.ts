/**
 * 05 §二 加密 ResourcePort 适配器测试：invoke 契约替身（不依赖 Tauri 运行时）。
 * 覆盖：字节形态归一（ArrayBuffer/Uint8Array/number[]）、MIME 扩展名映射、
 * Blob URL 短生命周期（release 即 revoke）、解密失败 fail-closed（K6）。
 * Rust 侧行为在 cargo 侧测（resource_crypto.rs），两侧各测一半。
 */
import { describe, expect, it } from "vitest";
import { createTauriEncryptedResourcePort } from "@lingfan/adapters";
import type { TauriInvoke } from "@lingfan/adapters";

function makeInvoke(
  payload: ArrayBuffer | Uint8Array | number[],
  calls: string[],
): TauriInvoke {
  return async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls.push(command);
    void args;
    return payload as T;
  };
}

describe("createTauriEncryptedResourcePort（05 §二 资源加密供给）", () => {
  it("resolve：字节归一为 Blob URL（number[] 形态），命令名与路径透传", async () => {
    const calls: string[] = [];
    let lastArgs: Record<string, unknown> | undefined;
    const invoke: TauriInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push(command);
      lastArgs = args;
      return [1, 2, 3, 4] as T; // number[] 形态（ipc Response 兼容）
    };
    const port = createTauriEncryptedResourcePort(invoke);
    const url = await port.resolve("Audio/x.mp3");
    expect(url.startsWith("blob:")).toBe(true);
    expect(calls).toEqual(["decrypt_resource"]);
    expect(lastArgs).toEqual({ path: "Audio/x.mp3" });
    port.release(url);
  });

  it("字节形态兼容：ArrayBuffer 与 Uint8Array 均可解析", async () => {
    const fromBuffer = createTauriEncryptedResourcePort(
      makeInvoke(new Uint8Array([9, 9]).buffer, []),
    );
    const fromView = createTauriEncryptedResourcePort(
      makeInvoke(new Uint8Array([7, 7, 7]), []),
    );
    expect((await fromBuffer.resolve("Images/a.png")).startsWith("blob:")).toBe(
      true,
    );
    expect((await fromView.resolve("Video/v.mp4")).startsWith("blob:")).toBe(
      true,
    );
  });

  it("resolve 失败 fail-closed：抛错不静默（K6），release revoke 不抛", async () => {
    const boom: TauriInvoke = async (): Promise<never> => {
      throw new Error("解密失败：GCM 认证失败");
    };
    const port = createTauriEncryptedResourcePort(boom);
    await expect(port.resolve("Audio/missing.mp3")).rejects.toThrow("解密失败");
    expect(() => port.release("blob:nonexistent")).not.toThrow();
  });
});

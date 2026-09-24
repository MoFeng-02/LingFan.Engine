/**
 * 05 §二 + ⑨-4c 加密 ResourcePort 适配器测试（流式形态）：invoke 契约替身
 * （不依赖 Tauri 运行时）。覆盖：JSON 负载解析（{"file"}）、lfstream URL 构造
 * （toStreamUrl 可注入）、命令名与路径透传、坏负载 fail-closed、K6 解密失败抛错。
 * Rust 侧行为在 cargo 侧测（resource_crypto.rs），两侧各测一半。
 */
import { describe, expect, it } from "vitest";
import { createTauriEncryptedResourcePort } from "@lingfan/adapters";
import type { TauriInvoke } from "@lingfan/adapters";

function makeInvoke(
  payload: string,
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

describe("createTauriEncryptedResourcePort（⑨-4c 流式供给）", () => {
  it("resolve：JSON 负载 → lfstream URL（注入构造器），命令名与路径透传", async () => {
    const calls: string[] = [];
    let lastArgs: Record<string, unknown> | undefined;
    const invoke: TauriInvoke = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      calls.push(command);
      lastArgs = args;
      return JSON.stringify({ file: "abc123.mp4" }) as T;
    };
    const seenFiles: string[] = [];
    const port = createTauriEncryptedResourcePort(invoke, async (file) => {
      seenFiles.push(file);
      return `lfstream://localhost/${file}`;
    });
    const url = await port.resolve("Video/m2.mp4");
    expect(url).toBe("lfstream://localhost/abc123.mp4");
    expect(calls).toEqual(["decrypt_resource"]);
    expect(lastArgs).toEqual({ path: "Video/m2.mp4" });
    expect(seenFiles).toEqual(["abc123.mp4"]);
    port.release(url); // 临时缓存生命周期归 Rust：release 无害
  });

  it("坏负载 fail-closed：非 JSON / 缺 file 字段均抛错", async () => {
    const notJson = createTauriEncryptedResourcePort(makeInvoke("not-json", []));
    await expect(notJson.resolve("Video/v.mp4")).rejects.toThrow("负载异常");
    const noFile = createTauriEncryptedResourcePort(
      makeInvoke(JSON.stringify({ url: "x" }), []),
    );
    await expect(noFile.resolve("Video/v.mp4")).rejects.toThrow("缺 file");
    const emptyFile = createTauriEncryptedResourcePort(
      makeInvoke(JSON.stringify({ file: "" }), []),
    );
    await expect(emptyFile.resolve("Video/v.mp4")).rejects.toThrow("缺 file");
  });

  it("resolve 失败 fail-closed：抛错不静默（K6），release 不抛", async () => {
    const boom: TauriInvoke = async (): Promise<never> => {
      throw new Error("解密失败：GCM 认证失败");
    };
    const port = createTauriEncryptedResourcePort(boom);
    await expect(port.resolve("Audio/missing.mp3")).rejects.toThrow("解密失败");
    expect(() => port.release("lfstream://localhost/x.mp4")).not.toThrow();
  });
});

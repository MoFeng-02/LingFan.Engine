/**
 * 明文 ResourcePort 适配器测试：invoke 契约替身（不依赖 Tauri 运行时）。
 * 覆盖：路径规范化先于调用、命令名与参数键、Rust 构造的 url 直通、坏负载 fail-closed、
 * 越出资源根的 id 在信任边界上拒绝。
 * 协议段与编码归 Rust（cargo 侧测），两侧各测一半。
 */
import { describe, expect, it } from "vitest";
import mainSource from "../../../apps/playground/src/main.ts?raw";
import { createTauriResourcePort } from "@lingfan-engine/adapters";
import type { TauriInvoke } from "@lingfan-engine/adapters";

/** 供给替身：记录命令名与参数，返回给定负载 */
function makeInvoke(payload: string, calls: string[]) {
  let lastArgs: Record<string, unknown> | undefined;
  const invoke: TauriInvoke = async <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls.push(command);
    lastArgs = args;
    return payload as T;
  };
  return { invoke, args: () => lastArgs };
}

const PLAIN_URL = "http://lfraw.localhost/raw/Audio%2Fbgm.mp3";

describe("createTauriResourcePort（明文原生供给）", () => {
  it("resolve：Rust 构造的 url 直通；命令名与参数键为 resource_url / path", async () => {
    const calls: string[] = [];
    const { invoke, args } = makeInvoke(
      JSON.stringify({ url: PLAIN_URL }),
      calls,
    );
    const port = createTauriResourcePort(invoke);
    const url = await port.resolve("Audio/bgm.mp3");
    expect(url).toBe(PLAIN_URL);
    expect(calls).toEqual(["resource_url"]);
    expect(args()).toEqual({ path: "Audio/bgm.mp3" });
    expect(() => port.release(url)).not.toThrow(); // 无临时副本：release 无副作用
  });

  it("resolve：路径先规范化再交给 Rust（前导斜杠剥掉、首尾空白裁掉）", async () => {
    const { invoke, args } = makeInvoke(JSON.stringify({ url: PLAIN_URL }), []);
    const port = createTauriResourcePort(invoke);
    await port.resolve("  /Audio/bgm.mp3  ");
    expect(args()).toEqual({ path: "Audio/bgm.mp3" });
  });

  it("坏负载 fail-closed：非 JSON / 缺 url / 空 url 均抛错", async () => {
    const notJson = createTauriResourcePort(makeInvoke("not-json", []).invoke);
    await expect(notJson.resolve("Audio/a.mp3")).rejects.toThrow("负载异常");
    const noUrl = createTauriResourcePort(
      makeInvoke(JSON.stringify({ path: "Audio/a.mp3" }), []).invoke,
    );
    await expect(noUrl.resolve("Audio/a.mp3")).rejects.toThrow("缺 url");
    const emptyUrl = createTauriResourcePort(
      makeInvoke(JSON.stringify({ url: "" }), []).invoke,
    );
    await expect(emptyUrl.resolve("Audio/a.mp3")).rejects.toThrow("缺 url");
  });

  it("越出资源根的 id 在调用前拒绝（不把可疑路径交给协议层）", async () => {
    const calls: string[] = [];
    const { invoke } = makeInvoke(JSON.stringify({ url: PLAIN_URL }), calls);
    const port = createTauriResourcePort(invoke);
    for (const id of ["", "   ", "..", "../secret.txt", "Audio//a.mp3"]) {
      await expect(port.resolve(id)).rejects.toThrow("资源路径");
    }
    expect(calls).toEqual([]); // 拒绝发生在信任边界，未触达 Rust
  });

  it("resolve 失败 fail-closed：invoke 抛错原样上抛", async () => {
    const boom: TauriInvoke = async (): Promise<never> => {
      throw new Error("资源根不可用");
    };
    const port = createTauriResourcePort(boom);
    await expect(port.resolve("Audio/a.mp3")).rejects.toThrow("资源根不可用");
  });
});

describe("组合根装配（源级互锁）", () => {
  it("壳形态一律原生供给：明文走明文端口，加密走加密端口，浏览器才落静态根", () => {
    expect(mainSource).toContain("createTauriResourcePort()");
    expect(mainSource).toContain("createTauriEncryptedResourcePort()");
    expect(mainSource).toContain("createStaticResourcePort()");
    // 明文壳不得再落到静态根：静态根只出现在浏览器分支里
    const branches = mainSource.slice(mainSource.indexOf("let resourcePort"));
    expect(branches.indexOf("createStaticResourcePort()")).toBeLessThan(
      branches.indexOf("createTauriEncryptedResourcePort()"),
    );
    expect(branches).toContain("if (!useNative)");
  });
});

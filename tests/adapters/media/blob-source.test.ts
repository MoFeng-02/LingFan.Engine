/**
 * 媒体源物化：受管自定义协议的媒体改经「无 `Range` 取回全量 →
 * Blob URL」供给——Android WebView 对**带 `Range` 头**的拦截响应会在网络层失败（非零起点区间
 * 必错），而非 faststart 的 MP4 解复用必然读尾部 ⇒ 播放必坏。
 * 行为用真值表锁，接线用源级断言锁（组合根只在「原生 + 加密 + Android」三条件下开启）。
 */
import { describe, expect, it, vi } from "vitest";
import mainSource from "../../../apps/playground/src/main.ts?raw";
import videoSource from "../../../packages/adapters/src/media/videoPort.ts?raw";
import audioSource from "../../../packages/adapters/src/media/audioPort.ts?raw";
import resourceCryptoSource from "../../../apps/playground/src-tauri/src/resource_crypto.rs?raw";
import { createBlobSource } from "@lingfan/adapters";

/** 受管协议 v1 token 形态（{hex64}.{ext}） */
const TOKEN_URL = `http://lfstream.localhost/${"a".repeat(64)}.mp4`;
/** 受管协议分块供给形态（`v2/` 前缀） */
const CHUNKED_URL = "http://lfstream.localhost/v2/Video%2Fbig.mp4";

/** 取数实现签名（与 `typeof fetch` 兼容） */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 供给替身：按调用序返回同一内容（调用参数由用例断言） */
function fetchStub(impl: () => Promise<Response>) {
  return vi.fn<FetchLike>(impl);
}

function responseWith(
  bytes: number,
  headers: Record<string, string>,
  ok = true,
): Response {
  return new Response(new Uint8Array(bytes), {
    status: ok ? 200 : 404,
    headers,
  });
}

/** 正常供给替身：如实返回 content-length */
function okFetch(bytes = 8) {
  return fetchStub(async () =>
    responseWith(bytes, { "content-length": String(bytes) }),
  );
}

describe("物化行为", () => {
  it("取回全量并以 blob: URL 返回；请求不带 Range 头（Range 正是被拦截层搞坏的那类）", async () => {
    const fetchImpl = okFetch(1024);
    const source = createBlobSource({ maxBytes: 1 << 20, fetchImpl });
    const resolved = await source.materialize(TOKEN_URL);
    expect(resolved.startsWith("blob:")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0][1];
    expect(new Headers(init?.headers).has("range")).toBe(false);
    expect(init?.cache).toBe("no-store");
  });

  it("同 URL 记忆化：媒体端口以 URL 判等做无缝续播，不得重复物化", async () => {
    const fetchImpl = okFetch();
    const source = createBlobSource({ maxBytes: 1 << 20, fetchImpl });
    const first = await source.materialize(TOKEN_URL);
    const second = await source.materialize(TOKEN_URL);
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("并发同 URL 只保留一份物化结果（后到者丢弃，不泄漏）", async () => {
    const fetchImpl = okFetch();
    const source = createBlobSource({ maxBytes: 1 << 20, fetchImpl });
    const [a, b] = await Promise.all([
      source.materialize(TOKEN_URL),
      source.materialize(TOKEN_URL),
    ]);
    expect(b).toBe(a);
  });

  it("超过上限 = 原样返回（大媒体按需流式，不进 Blob）", async () => {
    const source = createBlobSource({ maxBytes: 1024, fetchImpl: okFetch(4096) });
    expect(await source.materialize(TOKEN_URL)).toBe(TOKEN_URL);
  });

  it("无声明长度 / 空资源 / 长度非法 = 原样返回（不把未知大小的资源读进内存）", async () => {
    const cases: Record<string, string>[] = [
      {},
      { "content-length": "0" },
      { "content-length": "abc" },
    ];
    for (const headers of cases) {
      const source = createBlobSource({
        maxBytes: 1 << 20,
        fetchImpl: fetchStub(async () => responseWith(4, headers)),
      });
      expect(await source.materialize(TOKEN_URL)).toBe(TOKEN_URL);
    }
  });

  it("非 2xx / 取数失败 = 原样返回且不抛（回落直供，元素自身错误路径仍报诊断）", async () => {
    const notOk = createBlobSource({
      maxBytes: 1 << 20,
      fetchImpl: fetchStub(async () => responseWith(0, {}, false)),
    });
    expect(await notOk.materialize(TOKEN_URL)).toBe(TOKEN_URL);
    const throws = createBlobSource({
      maxBytes: 1 << 20,
      fetchImpl: fetchStub(async () => {
        throw new Error("取数失败");
      }),
    });
    await expect(throws.materialize(TOKEN_URL)).resolves.toBe(TOKEN_URL);
  });

  it("分块供给（v2 前缀）不物化：无区间请求会让服务端整段解密", async () => {
    const fetchImpl = okFetch();
    const source = createBlobSource({ maxBytes: 1 << 20, fetchImpl });
    expect(await source.materialize(CHUNKED_URL)).toBe(CHUNKED_URL);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("release 后重新物化 = 重新取数（旧对象已释放，不返回已撤销的 URL）", async () => {
    const fetchImpl = okFetch();
    const source = createBlobSource({ maxBytes: 1 << 20, fetchImpl });
    const first = await source.materialize(TOKEN_URL);
    source.release(TOKEN_URL);
    const second = await source.materialize(TOKEN_URL);
    expect(second).not.toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("release 未物化的 URL 无副作用；dispose 后全部失效", async () => {
    const fetchImpl = okFetch();
    const source = createBlobSource({ maxBytes: 1 << 20, fetchImpl });
    expect(() => source.release(TOKEN_URL)).not.toThrow();
    const first = await source.materialize(TOKEN_URL);
    source.dispose();
    const second = await source.materialize(TOKEN_URL);
    expect(second).not.toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("接线与跨边界互锁", () => {
  it("组合根只在「原生 + 加密 + Android」三条件下开启物化（其余平台保持直供，桌面零改动）", () => {
    expect(mainSource).toContain('useNative && encrypted && host.os === "android"');
    expect(mainSource).toContain("MEDIA_BLOB_SOURCE_MAX_BYTES");
  });

  it("视频端口：src 只取物化结果，不得直连解析出的原 URL", () => {
    expect(videoSource).toContain("blobSource.materialize(url)");
    expect(videoSource).toContain("video.src = source");
    expect(videoSource).not.toContain("video.src = url");
  });

  it("音频端口：常驻通道与一次性音效都经物化；同源判等仍按逻辑 URL", () => {
    expect(audioSource).toContain("element.src = source");
    expect(audioSource).not.toContain("element.src = url");
    expect(audioSource).not.toContain("new Audio(url)");
    expect(audioSource).toContain("urls.get(channel) === url");
    expect(audioSource).toContain("Promise.resolve(url)"); // 未配置物化 = 原样返回
  });

  it("分块路径标记与 Rust 侧路由同源：服务端确以 `v2/` 前缀分派按需解密", () => {
    expect(resourceCryptoSource).toContain('strip_prefix("v2/")');
    expect(resourceCryptoSource).toContain('"{}/v2/{}"');
  });
});

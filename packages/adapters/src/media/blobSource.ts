/**
 * 受管自定义协议媒体源的 Blob 物化——Android WebView 的 Range 拦截缺陷绕过。
 *
 * 背景：Android WebView 对**带 `Range` 头**、经 `shouldInterceptRequest` 供给的响应会在拦截层
 * 直接失败（Chromium 40739128；上游同构实现 readest 的 `range_file.rs` 注释同记）。`start=0`
 * 天然免疫，坏的是后续**非零起点**区间。媒体元素只会自己发 `Range` 头，无法像 `fetch` 那样把
 * 区间编进 URL query（那条绕过通道只服务显式 range 的调用方）；而非 faststart 的 MP4（`moov`
 * 在文件尾）解复用**必然**要读尾部 ⇒ 必然命中，表现为 `<video>` 报
 * `PIPELINE_ERROR_READ: FFmpegDemuxer: data source error`。
 *
 * 解法：让浏览器根本不发网络 Range——先经**不带 `Range` 头**的请求取回全量字节，再把 `blob:` URL
 * 交给元素（本地解码、零网络 Range）。同逻辑 URL 记忆化：媒体端口以 URL 判等做「同源不重设 src」
 * 的无缝续播，每次重新物化会破坏该语义并泄漏 Blob。
 *
 * 代价与边界：物化后须整段驻留内存，故设上限——超过上限（或取数失败）原样返回，回落直供，
 * 由元素自身的 error 路径给出用户可见诊断；大媒体维持按需流式，不适用 Blob。
 * 大媒体（v2 分块形态）在 Android 上另由 Rust 改走本机回环 HTTP 供给（带完整 Range 语义，
 * 不经本模块），故此处只需负责上限内的小媒体。
 */

/** 媒体源物化：受管协议 URL → 可口喂媒体元素的 URL（必要时为 `blob:`） */
export interface BlobSource {
  /** 物化（同 URL 记忆化）；超上限 / 取数失败 / 无声明长度 = 原样返回 */
  materialize(url: string): Promise<string>;
  /** 释放该逻辑 URL 关联的 Blob（未物化则无副作用） */
  release(url: string): void;
  /** 释放全部（端口销毁时调用） */
  dispose(): void;
}

export interface BlobSourceOptions {
  /** 单资源物化上限（字节）：超过则不物化（大媒体按需流式，Blob 会把整段读进内存） */
  maxBytes: number;
  /** 取数实现（测试替身可注入）；缺省 = 全局 fetch */
  fetchImpl?: typeof fetch;
}

/**
 * 分块供给路径标记（协议内 `v2/` 前缀）：该形态下「无区间请求」= 服务端**整段解密**——
 * 大媒体会把整段明文读进内存。故这类 URL 一律不物化（大媒体按需流式，不适用 Blob）。
 *
 * 该标记同时覆盖**两种**自供流式通道：lfstream 的分块路径，以及 Android 大媒体改走的
 * 本机回环 HTTP（`http://127.0.0.1:<port>/…/v2/<逻辑路径>`——回环 URL 沿用同一 `v2/` 段，
 * 故此处无需为它新增分支；动机见 `apps/playground/src-tauri/src/media_http.rs` 模块头）。
 */
const CHUNKED_SUPPLY_MARKER = "/v2/";

export function createBlobSource(options: BlobSourceOptions): BlobSource {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const objectUrls = new Map<string, string>();

  async function materialize(url: string): Promise<string> {
    if (url.includes(CHUNKED_SUPPLY_MARKER)) return url;
    const cached = objectUrls.get(url);
    if (cached !== undefined) return cached;
    let response: Response;
    try {
      // 关键：不带 `Range` 头（fetch 默认不加）——带 `Range` 的请求正是被拦截层搞坏的那类
      response = await doFetch(url, { cache: "no-store" });
    } catch {
      return url; // 取数失败回落直供：元素自身错误路径仍给出用户可见诊断
    }
    if (!response.ok) return url;
    const declared = Number(response.headers.get("content-length"));
    if (!Number.isFinite(declared) || declared <= 0 || declared > options.maxBytes) {
      // 无声明长度 / 空资源 / 超上限：一律不物化，避免把未知大小的资源整段读进内存
      void response.body?.cancel();
      return url;
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    // 在途重复物化（同 URL 并发调用）时保留先到者，丢弃后到的，避免泄漏
    const existing = objectUrls.get(url);
    if (existing !== undefined) {
      URL.revokeObjectURL(objectUrl);
      return existing;
    }
    objectUrls.set(url, objectUrl);
    return objectUrl;
  }

  function release(url: string): void {
    const objectUrl = objectUrls.get(url);
    if (objectUrl === undefined) return;
    objectUrls.delete(url);
    URL.revokeObjectURL(objectUrl);
  }

  function dispose(): void {
    for (const objectUrl of objectUrls.values()) URL.revokeObjectURL(objectUrl);
    objectUrls.clear();
  }

  return { materialize, release, dispose };
}

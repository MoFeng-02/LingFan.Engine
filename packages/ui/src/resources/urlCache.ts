/**
 * 资源 URL 缓存：逻辑资源路径 → 已解析 URL（UI 侧单一实现）。
 *
 * 元素渲染是同步的（`renderElementTree` 直接产 DOM），而资源解析是异步的——
 * 这个接缝把两者对上：同步查表 → 在途去重 → 命中即返回 URL；
 * 未命中**只启动一次**异步解析，落地后回调宿主；失败不粘滞（资源补上后仍可再试），
 * 也不触发回调——不伪造 URL，诊断归端口/宿主。
 *
 * 释放策略归**消费方**：本模块只提供「已落地 URL」的枚举与清空，
 * 何时释放（以及释放几次）由消费方在自己的销毁路径上决定。
 */
export interface ResourceUrlCacheOptions {
  /** 解析落地后的回调（宿主据此重渲染表层）；失败不触发 */
  onResolved?: () => void;
}

export interface ResourceUrlCache {
  /** 同步查表：已落地返回 URL；未落地（未请求或在途）返回 `undefined` */
  get(path: string): string | undefined;
  /** 取用：命中即返回；未命中只发起一次解析（同路径在途去重）；失败不粘滞 */
  resolve(path: string): Promise<string>;
  /** 已落地 URL（消费方据此统一释放） */
  values(): IterableIterator<string>;
  /** 清空缓存（可重复调用） */
  clear(): void;
}

export function createResourceUrlCache(
  resolveUrl: (path: string) => Promise<string>,
  options: ResourceUrlCacheOptions = {},
): ResourceUrlCache {
  const urls = new Map<string, string>();
  /** 在途解析：同一路径的并发取用共用同一次解析（失败即移除，不粘滞） */
  const inFlight = new Map<string, Promise<string>>();

  return {
    get(path: string): string | undefined {
      return urls.get(path);
    },
    resolve(path: string): Promise<string> {
      const cached = urls.get(path);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = inFlight.get(path);
      if (pending !== undefined) return pending;
      const promise = resolveUrl(path)
        .then((url) => {
          urls.set(path, url);
          inFlight.delete(path);
          options.onResolved?.();
          return url;
        })
        .catch((error: unknown) => {
          inFlight.delete(path); // 失败不粘滞：资源补上后仍可再试
          throw error;
        });
      inFlight.set(path, promise);
      return promise;
    },
    values(): IterableIterator<string> {
      return urls.values();
    },
    clear(): void {
      urls.clear();
    },
  };
}

/**
 * 元素资源解析缓存：`ResourcePort.resolve` 的**同步查表皮**（三宿主共用单一事实源）。
 *
 * 元素渲染是同步的（`renderElementTree` 直接产 DOM），而资源解析是异步的——
 * 这个接缝把两者对上：同步查表 → 在途去重 → 命中即返回 URL；
 * 未命中**只启动一次**异步解析，落地后回调宿主重渲染（整体重建语义，与 renderElementTree 一致）；
 * 失败保持替代文本（不伪造 URL，诊断归端口/宿主）。
 *
 * 缓存机制本身在资源域（`../resources`）只有一份；此处只把它对到元素渲染的同步契约上。
 */
import { createResourceUrlCache } from "../resources";

/**
 * 装配输入：一个异步解析函数 + 一个「落地了」的回调。
 * 缓存不关心 URL 怎么来的——换掉 `resolve` 就换了取源方式（本地 / 远端 / 测试替身）。
 */
export interface ElementResourceResolverOptions {
  /** 资源解析（通常即 `resourcePort.resolve`） */
  resolve: (path: string) => Promise<string>;
  /** 解析落地后的回调（宿主据此重渲染元素层） */
  onResolved: () => void;
}

/**
 * 元素渲染侧看到的解析器：**同步**的一问一答。
 * 只暴露这一个方法——在途去重、缓存、失败重试的细节都封在工厂里，
 * 调用点（`renderElementTree`）不需要知道资源是异步拿到的。
 */
export interface ElementResourceResolver {
  /** 供 `renderElementTree` 的 `resolveResource` 使用；未就绪返回 `undefined`（显示替代文本） */
  resolveForElement: (path: string) => string | undefined;
}

/**
 * 把异步资源端口接到元素渲染的同步契约上。
 *
 * 未命中时启动一次解析并立即返回 `undefined`（这一帧显示替代文本），
 * 落地后经 `onResolved` 让宿主重渲染；解析失败不缓存失败态，下次问还会再试。
 */
export function createElementResourceResolver(
  options: ElementResourceResolverOptions,
): ElementResourceResolver {
  const cache = createResourceUrlCache(options.resolve, {
    onResolved: options.onResolved,
  });
  return {
    resolveForElement(path: string): string | undefined {
      const cached = cache.get(path);
      if (cached !== undefined) return cached;
      // 失败不粘滞：资源补上后仍可再试（错误归端口/宿主诊断，此处不重渲染）
      void cache.resolve(path).catch(() => undefined);
      return undefined;
    },
  };
}

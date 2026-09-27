/**
 * 08 §二.1 / U7 元素资源解析缓存：`ResourcePort.resolve` 的**同步查表皮**。
 *
 * 元素渲染是同步的（`renderElementTree` 直接产 DOM），而资源解析是异步的——
 * 这个接缝把两者对上：命中即返回 URL；未命中**只启动一次**异步解析，落地后回调宿主
 * 重渲染（整体重建语义，与 ⑨-13 的 renderElementTree 一致）；失败保持替代文本
 * （不伪造 URL，诊断归端口/宿主）。
 *
 * 三处宿主（playground / 模板 / 编辑器预览）共用同一份实现——宿主只提供端口与重渲染回调，
 * 不再各写一遍（⑨-14 教训：**能共用的纯逻辑一律归库**，避免第二真源）。
 */
export interface ElementResourceResolverOptions {
  /** 资源解析（通常即 `resourcePort.resolve`） */
  resolve: (path: string) => Promise<string>;
  /** 解析落地后的回调（宿主据此重渲染元素层） */
  onResolved: () => void;
}

export interface ElementResourceResolver {
  /** 供 `renderElementTree` 的 `resolveResource` 使用；未就绪返回 `undefined`（显示替代文本） */
  resolveForElement: (path: string) => string | undefined;
}

export function createElementResourceResolver(
  options: ElementResourceResolverOptions,
): ElementResourceResolver {
  const urls = new Map<string, string>();
  const pending = new Set<string>();
  return {
    resolveForElement(path: string): string | undefined {
      const cached = urls.get(path);
      if (cached !== undefined) return cached;
      if (!pending.has(path)) {
        pending.add(path);
        void options
          .resolve(path)
          .then((url) => {
            urls.set(path, url);
            pending.delete(path);
            options.onResolved();
          })
          .catch(() => {
            pending.delete(path); // 失败不粘滞：资源补上后仍可再试
          });
      }
      return undefined;
    },
  };
}
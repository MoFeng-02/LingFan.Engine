/**
 * 部署 base 前缀工具。
 *
 * 站点部署在 GitHub Pages 项目站，线上根路径不是 `/` 而是 `/LingFan.Engine/`。
 * Astro 只给「自己生成的」链接补 base（侧栏、导航、favicon、sitemap），
 * **手写在 .astro 里的路径不会被改写**，所以这里统一完成。
 *
 * Markdown 正文里的链接不走本文件，由 src/plugins/hast-base-links.mjs 在
 * 构建期处理——两条路径共用 astro.config.mjs 里的同一个 base 值。
 *
 * Astro 会把 BASE_URL 规范成带尾斜杠的形式（根部署时为 `/`）。
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, "");

/**
 * 给站内根绝对路径补上 base。已经是外链、锚点、相对路径或已带 base 的值原样返回。
 *
 * @param path 以 `/` 开头的站内路径，例如 `/logo-mark.png`。
 */
export function withBase(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  if (!BASE || path === BASE || path.startsWith(`${BASE}/`)) return path;
  return BASE + path;
}

/**
 * 给站内根绝对路径补上「locale 前缀 + base」，用于组件里需要跟随当前页
 * 语言的链接（如页脚导航）。locale 取自 `Astro.locals.starlightRoute.locale`：
 * 非 root locale 页面是路径段（如 `en`），root locale 页面为 `undefined`
 * （见 @astrojs/starlight dist/utils/routing/types.d.ts 的 `LocaleData.locale`）。
 *
 * 与 withBase 相同的透传规则：外链、协议相对路径、纯锚点原样返回；已带该
 * locale 前缀的站内路径不会重复拼接。对 root locale（locale 为 undefined）
 * 等价于 withBase(path)。
 *
 * @param path 以 `/` 开头的站内路径，例如 `/concepts/story/`。
 * @param locale 当前页的 locale 路径段（如 `en`），root locale 页面传 undefined。
 */
export function withLocale(path: string, locale: string | undefined): string {
  const internal = path.startsWith("/") && !path.startsWith("//");
  if (!internal || !locale || path.startsWith(`/${locale}/`))
    return withBase(path);
  return withBase(`/${locale}${path}`);
}

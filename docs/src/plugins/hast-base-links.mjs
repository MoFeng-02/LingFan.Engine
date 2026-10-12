/**
 * Sätteri hast 插件：给 Markdown 里的根绝对链接补上部署 base 前缀。
 *
 * 为什么需要它：站点部署在 GitHub Pages 项目站（`/LingFan.Engine/`），而 Astro
 * 不会改写 Markdown 正文里手写的链接——`[快速开始](/getting-started/)` 会被原样
 * 输出成 `/getting-started/`，线上 404。让每位作者在正文里硬编码 `/LingFan.Engine/`
 * 会把「仓库叫什么名字」这个部署细节漏进内容，改名即全站断链。
 *
 * 所以：作者写自然的根绝对路径，base 只在 astro.config.mjs 里出现一次，构建期补齐。
 * base 为空（根部署）时本插件是空操作。
 */

/** 需要改写的元素与属性。 */
const URL_ATTRS = {
  a: ["href"],
  img: ["src"],
  source: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  iframe: ["src"],
  embed: ["src"],
  track: ["src"],
};

/** `/LingFan.Engine/` -> `/LingFan.Engine`；`/` 或空 -> `''`（根部署，不做任何事）。 */
function normalizeBase(base) {
  if (!base || base === "/") return "";
  return base.replace(/\/+$/, "");
}

/** 只改「本站根绝对路径」，放过外链、协议相对链接、锚点、相对路径和已带 base 的值。 */
function withBase(value, prefix) {
  if (typeof value !== "string" || !value.startsWith("/")) return value;
  if (value.startsWith("//")) return value;
  if (value === prefix || value.startsWith(`${prefix}/`)) return value;
  return prefix + value;
}

/**
 * @param {{ base?: string }} options `astro.config.mjs` 的 `base` 值。
 * @returns Sätteri hast 插件（纯对象字面量，无需运行时依赖）。
 */
export function hastBaseLinks({ base } = {}) {
  const prefix = normalizeBase(base);
  if (!prefix) return { name: "lf-base-links-noop" };

  return {
    name: "lf-base-links",
    element: {
      filter: Object.keys(URL_ATTRS),
      // 必须用 ctx.setProperty 写回：Sätteri 在 Rust 侧持有节点 arena，
      // 传给 visitor 的 node 只是只读快照，直接改 node.properties 会被丢弃
      // （不报错，静默无效）。内置插件同样只走 setProperty。
      visit(node, ctx) {
        const properties = node.properties;
        if (!properties) return;
        for (const attr of URL_ATTRS[node.tagName] ?? []) {
          const next = withBase(properties[attr], prefix);
          if (next !== properties[attr]) ctx.setProperty(node, attr, next);
        }
      },
    },
  };
}

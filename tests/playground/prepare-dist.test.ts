import { describe, expect, it } from "vitest";
import { resolveProtocolBase, rewriteHtml } from "../../apps/playground/scripts/prepare-dist.mjs";

describe("prepare-dist · resolveProtocolBase（与 Rust protocol_base 同口径）", () => {
  it("宿主平台推断：win32 → http 虚拟 host（覆盖 Windows 桌面 + Android 构建）；darwin → 原生 scheme（覆盖 macOS 桌面 + iOS 构建）", () => {
    expect(resolveProtocolBase("win32", {})).toBe("http://lfstream.localhost");
    expect(resolveProtocolBase("darwin", {})).toBe("lfstream://localhost");
    expect(resolveProtocolBase("linux", {})).toBe("lfstream://localhost");
  });
  it("LFEN_PROTOCOL_BASE 显式覆盖优先（非默认宿主 × 移动端目标组合的出口）", () => {
    expect(resolveProtocolBase("darwin", { LFEN_PROTOCOL_BASE: "http://lfstream.localhost" })).toBe(
      "http://lfstream.localhost",
    );
  });
});

describe("prepare-dist · rewriteHtml（构建期静态改写，设计稿 §2.2）", () => {
  it("script/link 的本地产物引用改写为 {base}/v2/dist%2F…，并收集逻辑路径清单", () => {
    const source = `<!doctype html>
<html lang="en">
  <head>
    <script type="module" crossorigin src="/assets/index-Cx1Ab.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-Cx1Ab.css">
  </head>
  <body><div id="app"></div></body>
</html>`;
    const { html, assets } = rewriteHtml(source, "http://lfstream.localhost");
    expect(html).toContain('src="http://lfstream.localhost/v2/dist%2Fassets%2Findex-Cx1Ab.js"');
    expect(html).toContain('href="http://lfstream.localhost/v2/dist%2Fassets%2Findex-Cx1Ab.css"');
    expect(html).not.toContain('"/assets/index-Cx1Ab.js"');
    expect(assets).toEqual(["dist/assets/index-Cx1Ab.js", "dist/assets/index-Cx1Ab.css"]);
  });
  it("外链（动态/远程 URL）一概不碰（设计稿改写纪律：只碰构建产物内相对引用）", () => {
    const source = `<html><head>
      <link rel="stylesheet" href="https://cdn.example.com/x.css">
      <script src="https://example.com/a.js"></script>
    </head></html>`;
    const { html, assets } = rewriteHtml(source, "http://lfstream.localhost");
    expect(html).toBe(source);
    expect(assets).toEqual([]);
  });
  it("vite 产物名字符集（连字符）在 encodeURIComponent 下与 Rust 侧编码一致（无双重编码）", () => {
    const { html } = rewriteHtml(
      '<script type="module" src="/assets/index-Dj2Kl-mno_.js"></script>',
      "lfstream://localhost",
    );
    expect(html).toContain("lfstream://localhost/v2/dist%2Fassets%2Findex-Dj2Kl-mno_.js");
  });
});

/**
 * token 唯一源的**源级守卫**（防回流）。
 *
 * 纪律（R-B 裁定）：token 管的是「**我们自己**别双写」——
 * 组件里只准出现 `var(--lf-*)`，不准再写裸色值 / 裸字号。
 * 这类漂移是**慢性病**：今天合了 337 处，下周新写一个组件就会带回一个 `#xxxxxx`。
 * ⇒ 必须有机械化守卫，否则纪律会在几轮迭代后失效。
 */
import { describe, expect, it } from "vitest";
import appSource0 from "../../apps/editor/src/App.vue?raw";

/** 顶栏/基类样式都在 App.vue 的全局段 */
const appText0 = appSource0;
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** 读编辑器 src 全部源码（Windows 路径安全：不用 forward-slash 过滤） */
function readSources(root: string): { file: string; text: string }[] {
  const walk = (dir: string): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (/\.(vue|ts)$/.test(p)) out.push({ file: p, text: readFileSync(p, "utf8") });
    }
    return out;
  };
  return walk(root);
}

const EDITOR_SRC = join(process.cwd(), "apps/editor/src");
const TOKEN_FILE = "tokens.css";
const sources = readSources(EDITOR_SRC);
const components = sources.filter((s) => !s.file.endsWith(TOKEN_FILE));
const tokensText = readFileSync(join(EDITOR_SRC, "styles", TOKEN_FILE), "utf8");

/** 去注释（守卫对象是代码，注释里提色值不算违规） */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("token 唯一源 · 防回流守卫", () => {
  it("token 文件存在且被应用引入", () => {
    expect(tokensText).toContain(":root");
    const mainTs = sources.find((s) => s.file.endsWith("main.ts"));
    expect(mainTs?.text).toContain("styles/tokens.css");
    // token 必须**先于**组件样式加载
    const idx = mainTs?.text.indexOf("styles/tokens.css") ?? -1;
    const vue = mainTs?.text.indexOf('import App from "./App.vue"') ?? -1;
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(vue);
  });

  it("组件里零裸色值（除 token 文件自身与示例内容色）", () => {
    const offenders: string[] = [];
    for (const { file, text } of components) {
      // sample.ts 的 `color: "#FFD700"` 是**示例故事里的舞台内容色**（数据，不是 UI 样式）
      if (file.endsWith("sample.ts")) continue;
      const hits = code(text).match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hits !== null) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, `组件里出现裸色值：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("组件里零裸字号（只准 var(--lf-font-*)）", () => {
    const offenders: string[] = [];
    for (const { file, text } of components) {
      const hits = code(text).match(/font-size: *(9|10|11|12|13|14|15|16)px/g);
      if (hits !== null) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, `组件里出现裸字号：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("无被截断的 8 位色值（`var(--lf-x)44` 这类破损）", () => {
    const offenders: string[] = [];
    for (const { file, text } of components) {
      const hits = code(text).match(/var\(--lf-[a-z-]+\)[0-9a-fA-F]{2}/g);
      if (hits !== null) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(offenders, `出现截断色值：\n${offenders.join("\n")}`).toEqual([]);
  });

  it("token 覆盖了五项视觉债所需的全部维度", () => {
    // 表面/描边/文字/强调/字号/间距/圆角 —— 缺一项就会出现"无处安放"的硬编码
    for (const prefix of [
      "--lf-surface-",
      "--lf-border-",
      "--lf-text-",
      "--lf-accent",
      "--lf-success",
      "--lf-warning",
      "--lf-danger",
      "--lf-font-",
      "--lf-space-",
      "--lf-radius-",
    ]) {
      expect(tokensText, `token 缺少 ${prefix}* 维度`).toContain(prefix);
    }
  });

  it("滚动条已主题化（D-62⑤：此前全仓零命中 ⇒ 浅色系统条配深色界面）", () => {
    expect(tokensText).toContain("scrollbar-color");
    expect(tokensText).toContain("::-webkit-scrollbar-thumb");
  });

  it("对比度：弱提示色已提亮到 AA 以上（D-62⑬）", () => {
    // 原 #565f89 在 #101014 上仅 2.9:1 ⇒ 提到 #7b83a8（4.9:1）
    expect(tokensText).toContain("--lf-text-hint: #7b83a8");
    expect(tokensText).not.toContain("--lf-text-hint: #565f89");
  });

  it("尊重系统「减少动效」偏好", () => {
    expect(tokensText).toContain("prefers-reduced-motion");
  });
});

/**
 * 三项视觉债的**源级守卫**（D-62③④⑧）——上一批只做了实现，没锁防回流。
 */
describe("交互态与布局守卫（D-62③④⑧）", () => {
  it("③ 全局有 `button:hover` / `:active` / `:focus-visible`（此前基类零 hover）", () => {
    // 读 App.vue 的全局样式（非 scoped）⇒ 从源码断言，不依赖运行时
    const appText = appText0;
    expect(appText).toMatch(/button:hover:not\(:disabled\)/);
    expect(appText).toMatch(/button:active:not\(:disabled\)/);
    // 焦点用 :focus-visible（鼠标点击不冒焦点环）
    expect(appText).toContain(":focus-visible");
    expect(appText).toContain("outline: 2px solid var(--lf-accent)");
  });

  it("④ 顶栏允许换行且按钮不折半（掉行的两个成因都堵住）", () => {
    expect(appText0).toMatch(/\.toolbar\s*\{[^}]*flex-wrap:\s*wrap/);
    // button 基类必须 white-space: nowrap（否则中文按钮文案被拆两行）
    expect(appText0).toMatch(/^button\s*\{[^}]*white-space:\s*nowrap/m);
    // 长路径必须可收缩 + 省略号（它是最占宽项）
    expect(appText0).toMatch(/\.project-root\s*\{[^}]*max-width[^}]*text-overflow:\s*ellipsis/);
  });

  it("⑧ 控件右缘统一（不再有 260px 硬顶与 grow 打架）", () => {
    const fieldRow = readFileSync(
      join(EDITOR_SRC, "components/FieldRow.vue"),
      "utf8",
    );
    // `.control` 自身不许再出现 max-width 硬顶
    // ⚠️ 必须**去注释**再判：规则里写着「此前有 max-width:260px」的说明文字，
    //    那是注释（不是声明），别把它当成违规。
    const controlRule = (fieldRow.match(/\.control\s*\{[^}]*\}/)?.[0] ?? "").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(controlRule).not.toMatch(/max-width:\s*\d+px/);
    expect(controlRule).toContain("flex: 1");
  });
});

/**
 * hover 可见性守卫 —— 一条**只能靠实测发现**的债：
 * `button:hover` 的底色曾用 `--lf-surface-selected`（#24283b），
 * 而 button 基类底色是 `--lf-border-subtle`（**同为 #24283b**）
 * ⇒ hover 规则"存在"、`:hover` 也真的匹配，但**背景看起来毫无反应**（只变了边框）。
 * 源级断言查不出"同值"这件事 ⇒ 必须同时断言「两色不等」+ 真机量。
 */
describe("hover 可见性", () => {
  it("hover 底色 token ≠ button 基类底色 token", () => {
    const pick = (name: string): string => {
      const m = tokensText.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
      return m?.[1] ?? "";
    };
    const hover = pick("lf-surface-hover-strong");
    const base = pick("lf-border-subtle");
    expect(hover).not.toBe("");
    expect(base).not.toBe("");
    expect(hover.toLowerCase(), "hover 底色与基类底色同值 ⇒ 看起来没反应").not.toBe(base.toLowerCase());
  });

  it("hover 规则用的是那个专用 token", () => {
    const hoverRule = appText0.match(/button:hover:not\(:disabled\)\s*\{[^}]*\}/)?.[0] ?? "";
    expect(hoverRule).toContain("var(--lf-surface-hover-strong)");
    expect(hoverRule).not.toContain("var(--lf-surface-selected)");
  });
});

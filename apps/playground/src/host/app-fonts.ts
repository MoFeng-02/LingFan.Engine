/**
 * 字体展示资产的宿主侧装配：Vite 构建期扫描 Resources/Fonts 产出 `virtual:story-fonts`
 * 清单（与 stories:build 的字体名注册表同源），本模块按扩展名注入 @font-face、声明
 * 项目默认字体（主题面）并装配渲染层注册表。
 *
 * 字体是纯展示资产（无运行时状态），引擎侧不设端口；故事层只写字体名字符串，
 * 构建期 fail-closed（stories:build）+ 运行期回退（渲染层注册表回调）两档守门。
 * 资源 URL 走静态根（/Fonts/<file>，publicDir 镜像）；Tauri 形态由 bundle.resources
 * 覆盖 Resources/**，URL 形态一致。
 */
import { configureStoryFonts } from "@lingfan/ui";
import { storyFonts } from "virtual:story-fonts";

/** 扩展名 → @font-face format()（与注册表扩展名集合一致） */
const FORMAT_BY_EXT: Record<string, string> = {
  ".ttf": "truetype",
  ".otf": "opentype",
  ".woff": "woff",
  ".woff2": "woff2",
};

/**
 * 项目默认字体（主题面，RenPy `gui.rpy` 的宿主对应物）：整条字体分辨链最宽的一档，
 * 所有未显式声明字体的对话都落到它。取值必须是 Resources/Fonts 里的字体名；
 * undefined = 未声明（对话排版走浏览器回退，其余分层照常生效）。
 */
const PROJECT_DEFAULT_FONT: string | undefined = undefined;

/** 根 CSS 变量名：builtin 对话排版消费它；宿主运行期 setProperty 同名覆盖即显式切换 */
const FONT_CSS_VAR = "--lf-story-font";

/**
 * 项目默认字体判定单点（测试锚点）：返回 null = 判定通过（含未声明）；返回消息 = 判定失败。
 * 开发态抛错 / 生产态告警回退的环境分派留在 {@link applyDefaultFont}——判定与环境副作用分离。
 */
export function defaultFontIssue(
  font: string | undefined,
  registeredNames: readonly string[],
): string | null {
  if (font === undefined) return null;
  if (registeredNames.includes(font)) return null;
  return `[fonts] 项目默认字体 "${font}" 未在 Resources/Fonts 注册——请补字体文件或改 PROJECT_DEFAULT_FONT`;
}

/**
 * 应用项目默认字体：先校验注册表，再把字体名写进根 CSS 变量。
 * 开发态未注册 = 抛错（作者当面改）；生产态 = 告警回退浏览器默认（不拦启动）。
 */
function applyDefaultFont(): void {
  const issue = defaultFontIssue(
    PROJECT_DEFAULT_FONT,
    storyFonts.map((entry) => entry.name),
  );
  if (issue === null) {
    if (PROJECT_DEFAULT_FONT !== undefined) {
      document.documentElement.style.setProperty(
        FONT_CSS_VAR,
        `'${PROJECT_DEFAULT_FONT}'`,
      );
    }
    return;
  }
  if (import.meta.env.DEV) throw new Error(issue);
  console.warn(`${issue}，已回退浏览器默认字体`);
}

/** 注入 @font-face、应用主题面并装配渲染层字体名注册表（boot 一次性调用；空清单 = 仅装配注册表） */
export function installStoryFonts(): void {
  if (storyFonts.length > 0) {
    const style = document.createElement("style");
    style.textContent = storyFonts
      .map(({ file, name }) => {
        const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
        const format = FORMAT_BY_EXT[ext] ?? "truetype";
        return `@font-face { font-family: '${name}'; src: url('/Fonts/${file}') format('${format}'); }`;
      })
      .join("\n");
    document.head.appendChild(style);
  }
  applyDefaultFont();
  configureStoryFonts({
    names: new Set(storyFonts.map((entry) => entry.name)),
    onUnregistered: (name) => {
      console.warn(
        `[fonts] 未注册的字体名 "${name}"——Resources/Fonts 里没有对应字体文件，已回退默认字体`,
      );
    },
  });
}

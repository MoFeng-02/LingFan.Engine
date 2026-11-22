/**
 * 项目默认字体（主题面，RenPy `gui.rpy` 的宿主对应物）：整条字体分辨链最宽的一档，
 * 所有未显式声明字体的对话都落到它。取值必须是 Resources/Fonts 里的字体名；
 * undefined = 未声明（对话排版走浏览器回退，逐句声明的字体照常生效）。
 *
 * 同时负责注入 @font-face（构建期清单来自 `virtual:story-fonts`，与 stories:build
 * 的字体名注册表同源）并装配渲染层的字体名注册表——boot 早期一次性调用，纯展示装配，
 * 无运行时状态。
 */
import { configureStoryFonts } from "@lingfan-engine/ui";
import { storyFonts } from "virtual:story-fonts";

/** 项目默认字体（Resources/Fonts 里的字体名；undefined = 未声明） */
const PROJECT_DEFAULT_FONT: string | undefined = undefined;

/** 根 CSS 变量名：对话排版消费它；运行期 setProperty 同名覆盖即显式切换 */
const FONT_CSS_VAR = "--lf-story-font";

/** 扩展名 → @font-face format()（与字体名注册表扩展名集合一致） */
const FORMAT_BY_EXT: Record<string, string> = {
  ".ttf": "truetype",
  ".otf": "opentype",
  ".woff": "woff",
  ".woff2": "woff2",
};

/**
 * 应用项目默认字体：先校验注册表，再把字体名写进根 CSS 变量。
 * 开发态未注册 = 抛错（作者当面改）；生产态 = 告警回退浏览器默认（不拦启动）。
 */
function applyDefaultFont(): void {
  if (PROJECT_DEFAULT_FONT === undefined) return;
  const registered = storyFonts.some(
    (entry) => entry.name === PROJECT_DEFAULT_FONT,
  );
  if (!registered) {
    const message = `[fonts] 项目默认字体 "${PROJECT_DEFAULT_FONT}" 未在 Resources/Fonts 注册——请补字体文件或改 PROJECT_DEFAULT_FONT`;
    if (import.meta.env.DEV) throw new Error(message);
    console.warn(`${message}，已回退浏览器默认字体`);
    return;
  }
  document.documentElement.style.setProperty(
    FONT_CSS_VAR,
    `'${PROJECT_DEFAULT_FONT}'`,
  );
}

/** 可用字体名清单（去重保序）：偏好面板字体档的选项来源，与 @font-face 注入同源 */
export function storyFontNames(): readonly string[] {
  return [...new Set(storyFonts.map((entry) => entry.name))];
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
  // 渲染层字体名注册表：{font=…}/逐句字体/玩家字体偏好都要经它校验，未注册名
  // fail-closed 回退默认字体并告警，而不是把任意名塞进 font-family 静默变字体。
  configureStoryFonts({
    names: new Set(storyFonts.map((entry) => entry.name)),
    onUnregistered: (name) => {
      console.warn(
        `[fonts] 未注册的字体名 "${name}"——Resources/Fonts 里没有对应字体文件，已回退默认字体`,
      );
    },
  });
}

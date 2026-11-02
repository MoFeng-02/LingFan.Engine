/// <reference types="vite/client" />

declare module "virtual:story-fonts" {
  /** 字体清单条目（构建期由资源根下的字体目录扫描产出，与 stories:build 注册表同源） */
  export interface StoryFontEntry {
    /** 文件名（含扩展名），@font-face 的 src 相对静态根（/Fonts/<file>） */
    readonly file: string;
    /** 字体名 = 文件名去扩展名，故事层只引用这个名字 */
    readonly name: string;
  }
  export const storyFonts: readonly StoryFontEntry[];
}

declare module "virtual:story-list" {
  /**
   * 故事文件清单（构建期扫描资源根下的故事目录得出，按路径码元序）。
   *
   * 含 `.story` 与 `.json` 两种产物：TS 创作链编译出的 `.json` 与手写 `.story` 同树共存，
   * 清单来源不因创作形态而变。
   */
  export const STORIES: readonly string[];
}

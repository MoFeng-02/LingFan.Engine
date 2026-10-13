/// <reference types="vite/client" />

declare module "virtual:story-fonts" {
  /** 字体清单条目（Vite 插件构建期由 Resources/Fonts 扫描产出，与 stories:build 注册表同源） */
  export interface StoryFontEntry {
    /** 文件名（含扩展名），@font-face 的 src 相对静态根（/Fonts/<file>） */
    readonly file: string;
    /** 字体名 = 文件名去扩展名，故事层只引用这个名字 */
    readonly name: string;
  }
  export const storyFonts: readonly StoryFontEntry[];
}

/// <reference types="vite/client" />

/**
 * 字体清单的宿主侧声明（脚手架工程自带，与 vite.config 的虚拟模块对应）。
 */
declare module "virtual:story-fonts" {
  /** 字体清单条目：file = 资源文件名，name = 字体名（文件名去扩展名） */
  export interface StoryFontEntry {
    file: string;
    name: string;
  }
  /** 构建期扫描 Resources/Fonts 的字体清单（与 stories:build 注册表同源） */
  export const storyFonts: readonly StoryFontEntry[];
}

/**
 * 故事清单的宿主侧声明：构建期递归扫描 `Resources/Stories/` 得到的逻辑路径表
 * （相对资源根，如 `Stories/title/title_main.story`）。
 */
declare module "virtual:story-list" {
  /** 按路径码元序排列的故事文件逻辑路径 */
  export const STORIES: readonly string[];
}

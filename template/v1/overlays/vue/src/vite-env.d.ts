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

/** 单文件组件的模块声明：`vue-tsc` 之外的工具读到 `.vue` 时不至于整片报错 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>
  >;
  export default component;
}

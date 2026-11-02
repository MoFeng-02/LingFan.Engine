/**
 * 构建期的两个虚拟模块：字体清单与故事清单。
 *
 * 两个清单都是**磁盘事实的投影**，不是需要作者维护的声明文件。让作者手抄名单的代价
 * 不是「多写一行」，而是漏抄时构建期毫无察觉——漏登记的那一列要到运行期才以
 * `unknown-column` 现形。
 *
 * 扫描实现不在这里：它属于 `@lingfan-engine/stories-build`（构建期清单的权威实现，
 * 与 `stories:build` 的字体名/故事清单同源）。本文件只负责把「资源根在哪」告诉它——
 * 缺省是工程资源根，改工程布局时改 `vite.config.ts` 的传参，不改扫描逻辑。
 */
import {
  storyFontsVirtual as sharedStoryFontsVirtual,
  storyListVirtual as sharedStoryListVirtual,
  type HostPlugin,
  type ResourceRootOptions,
} from "@lingfan-engine/stories-build/host-plugins";

/** 字体清单条目：file = 资源文件名，name = 字体名（文件名去扩展名） */
export interface StoryFontEntry {
  file: string;
  name: string;
}

/**
 * 字体清单虚拟模块：构建期扫描资源根下的字体目录产出字体名清单，
 * 宿主据此注入 @font-face 与项目默认字体。
 *
 * @param options 资源根覆盖；缺省 = 本文件同级的 `<RESOURCES_DIR>`
 */
export function storyFontsVirtual(
  options: ResourceRootOptions = {},
): HostPlugin {
  return sharedStoryFontsVirtual(options, import.meta.url);
}

/**
 * 故事清单虚拟模块：构建期扫描资源根下的故事目录得出要装载的故事文件表。
 *
 * TS 创作链的产物（`Stories.src/` 编译出的 `.json`）与手写 `.story` 落在同一棵树，
 * 共用这一条扫描——创作形态不改变清单的来源。
 *
 * @param options 资源根覆盖；缺省 = 本文件同级的 `<RESOURCES_DIR>`
 */
export function storyListVirtual(
  options: ResourceRootOptions = {},
): HostPlugin {
  return sharedStoryListVirtual(options, import.meta.url);
}

/**
 * 构建配置（小程序形态）：UniApp 的 Vite 插件，加上骨架那份字体扫描插件。
 *
 * 这里不能沿用骨架的 `vite ^8`：`@dcloudio/vite-plugin-uni` 的 peer 精确钉住
 * `vite 5.2.8` 与 `@vue/shared 3.4.21`，与仓库根的那一代不兼容。所以本层自带一份
 * vite 与 vue，靠包管理器的隔离安装各用各的——版本写在 `package.patch.json` 里，
 * 并列入 `create.pinned`，生成器才不会把它改写成 `^最新`。
 *
 * `publicDir` 仍是无条件的 `Resources`：开发期的 H5 形态与骨架共用同一个资源根。
 * `copyPublicDir: false` 是有意的——小程序包体里不装故事与素材（故事走工程接口
 * `GET <基址>/project` 一次性返回 `{manifest, stories}`，素材走资源端口按 id 取），
 * 构建产物因此只有代码。
 */
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import uniModule, {
  type VitePluginUniOptions,
} from "@dcloudio/vite-plugin-uni";
import { defineConfig, type Plugin } from "vite";

/** 字体扩展名：只有这些后缀会被当作可注册的字体 */
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"] as const;

/** 一份字体条目：`file` 是资源根下的相对路径，`name` 是字体族名（去扩展名的文件名） */
interface StoryFontEntry {
  readonly file: string;
  readonly name: string;
}

/** 扫描字体目录：目录不存在就是空表，不抛错 */
function scanFonts(fontsDir: string): StoryFontEntry[] {
  if (!existsSync(fontsDir)) return [];
  return readdirSync(fontsDir)
    .filter((entry) =>
      FONT_EXTENSIONS.some((ext) => entry.toLowerCase().endsWith(ext)),
    )
    .sort()
    .map((entry) => ({
      file: `Fonts/${entry}`,
      name: entry.slice(0, entry.lastIndexOf(".")),
    }));
}

/**
 * 字体清单虚拟模块：把「资源根里有哪些字体」以数据形态交给运行期注册。
 *
 * 用虚拟模块而不是构建期 import：字体是资源根里的文件，走资源端口寻址；
 * 构建期 import 在加密资源形态下无文件可指。
 */
function storyFontsVirtual(): Plugin {
  const moduleId = "virtual:story-fonts";
  const resolved = `\0${moduleId}`;
  const fontsDir = fileURLToPath(new URL("./Resources/Fonts", import.meta.url));
  return {
    name: "lingfan:story-fonts",
    resolveId: (id) => (id === moduleId ? resolved : undefined),
    load: (id) =>
      id === resolved
        ? `export const storyFonts = ${JSON.stringify(scanFonts(fontsDir))};`
        : undefined,
  };
}

type UniPluginFactory = (options?: VitePluginUniOptions) => Plugin[];

/**
 * 插件包是 CommonJS 构建：ESM 默认导入在不同加载路径下可能拿到命名空间对象
 * （`{ runDev, runBuild, default }`）而不是那个工厂，所以两种形态都认。
 */
const uni: UniPluginFactory =
  (uniModule as unknown as { default?: UniPluginFactory }).default ??
  (uniModule as unknown as UniPluginFactory);

export default defineConfig({
  // 资源根：与骨架同名同位，H5 形态直接从磁盘取，小程序形态不随包体分发
  publicDir: "Resources",
  build: {
    // 包体不装故事与素材：它们由工程接口与资源端口在运行期取
    copyPublicDir: false,
  },
  server: {
    // 与骨架同一个端口：两种形态的本地约定一致，切换形态不必改文档与脚本
    port: 1420,
    strictPort: true,
  },
  plugins: [uni(), storyFontsVirtual()],
});

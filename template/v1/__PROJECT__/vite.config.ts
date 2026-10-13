import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/** 字体文件扩展名集合（与 stories-build 的字体名注册表同口径） */
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"] as const;

/** 字体清单条目：file = 资源文件名，name = 字体名（文件名去扩展名） */
interface StoryFontEntry {
  file: string;
  name: string;
}

/** Resources/Fonts 扫描：点文件与未知扩展名跳过，文件名字典序稳定 */
function scanFonts(fontsDir: string): readonly StoryFontEntry[] {
  if (!existsSync(fontsDir)) return [];
  return readdirSync(fontsDir)
    .filter((file) => {
      const dot = file.lastIndexOf(".");
      return (
        dot > 0 &&
        (FONT_EXTENSIONS as readonly string[]).includes(
          file.slice(dot).toLowerCase(),
        )
      );
    })
    .sort()
    .map((file) => ({ file, name: file.slice(0, file.lastIndexOf(".")) }));
}

/**
 * 字体清单虚拟模块：构建期扫描 Resources/Fonts 产出字体名清单，
 * 宿主据此注入 @font-face 与项目默认字体——字体名注册表与 stories:build 同源，
 * 零新增依赖（脚手架工程保持可独立安装）。
 */
function storyFontsVirtual(): Plugin {
  const moduleId = "virtual:story-fonts";
  const fontsDir = fileURLToPath(new URL("./Resources/Fonts", import.meta.url));
  return {
    name: "story-fonts",
    resolveId(id) {
      if (id === moduleId) return `\0${moduleId}`;
      return null;
    },
    load(id) {
      if (id === `\0${moduleId}`) {
        return `export const storyFonts = ${JSON.stringify(scanFonts(fontsDir))};`;
      }
      return null;
    },
  };
}

/** 脚手架工程的 Vite 配置：仅约定资源根与宿主端口，其余随宿主需要自行扩展。 */
export default defineConfig({
  // 项目资源根即静态根 —— 故事里的逻辑路径 `Audio/x.mp3` 解析为 `/Audio/x.mp3`，
  // 开发与打包产物一致，不依赖进程工作目录。资源根之外无隐式查找路径。
  publicDir: "Resources",

  // 宿主端口与 Tauri 约定一致；换平台壳时只改这里
  server: { port: 1420, strictPort: true },

  plugins: [storyFontsVirtual()],
});

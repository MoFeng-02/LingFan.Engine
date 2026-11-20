/**
 * 构建配置（小程序形态）：UniApp 的 Vite 插件，加上骨架那份清单插件。
 *
 * 这里不能沿用骨架的 `vite ^8`：`@dcloudio/vite-plugin-uni` 的 peer 精确钉住
 * `vite 5.2.8` 与 `@vue/shared 3.4.21`，与仓库根的那一代不兼容。所以本层自带一份
 * vite 与 vue，靠包管理器的隔离安装各用各的——版本写在 `package.patch.json` 里，
 * 并列入 `create.pinned`，生成器才不会把它改写成 `^最新`。
 *
 * 清单扫描不再在本层另写一份：字体清单、故事清单与语言清单都取自骨架的 `./vite.plugins`
 * （实现属 `@lingfan-engine/stories-build`，与 `stories:build` 同源）。层与层之间
 * 只差插件数组，扫描规则一处维护——小程序形态同样需要故事与语言清单，否则它只能装载
 * 骨架里手写的那几列、也看不到工程里的译文语言。
 *
 * `publicDir` 仍是无条件的 `Resources`：开发期的 H5 形态与骨架共用同一个资源根。
 * `copyPublicDir: false` 是有意的——小程序包体里不装故事与素材（故事走工程接口
 * `GET <基址>/project` 一次性返回 `{manifest, stories}`，素材走资源端口按 id 取），
 * 构建产物因此只有代码。
 */
import uniModule, {
  type VitePluginUniOptions,
} from "@dcloudio/vite-plugin-uni";
import { defineConfig, type Plugin } from "vite";
import {
  langListVirtual,
  storyFontsVirtual,
  storyListVirtual,
} from "./vite.plugins.ts";

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
    // 移动端兼容：H5 形态跑老 WebView，语法目标 safari13（基线 Safari 13.1+/Chrome 85+）。
    // esbuild 只转语法不补内建方法——内建由 eslint 守卫兜底。
    target: "safari13",
  },
  server: {
    // 与骨架同一个端口：两种形态的本地约定一致，切换形态不必改文档与脚本
    port: 1420,
    strictPort: true,
  },
  plugins: [uni(), storyFontsVirtual(), storyListVirtual(), langListVirtual()],
});

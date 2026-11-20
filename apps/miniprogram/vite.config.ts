/**
 * 构建配置：页面层交给 UniApp 的 Vite 插件，编译到微信小程序。
 *
 * 插件对 vite 版本有硬约束（peer 5.2.8），仓库根用的是更新的大版本，所以本包自带一份，
 * 靠 pnpm 的隔离安装各用各的；叙事引擎与适配器仍是 workspace 源码，不经构建步骤。
 */
import uniModule, {
  type VitePluginUniOptions,
} from "@dcloudio/vite-plugin-uni";
import { defineConfig, type Plugin } from "vite";

type UniPluginFactory = (options?: VitePluginUniOptions) => Plugin[];

/**
 * 插件包是 CommonJS 构建：ESM 默认导入在不同加载路径下可能拿到命名空间对象
 * （`{ runDev, runBuild, default }`）而不是那个工厂，所以两种形态都认。
 */
const uni: UniPluginFactory =
  (uniModule as unknown as { default?: UniPluginFactory }).default ??
  (uniModule as unknown as UniPluginFactory);

export default defineConfig({
  // 移动端兼容：H5 形态跑老 WebView，语法目标 safari13（基线 Safari 13.1+/Chrome 85+）。
  // esbuild 只转语法不补内建方法——内建由 eslint 守卫兜底。
  build: { target: "safari13" },
  plugins: [uni()],
});

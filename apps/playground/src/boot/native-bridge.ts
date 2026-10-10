/**
 * 浏览器形态接宿主的两条通道：
 *
 * - dev 期经 WS 桥复用宿主能力（读工程 / 存档 / 平台事实；Rust 侧白名单最小暴露面），
 *   宿主没起来就快速失败、让组合根维持 web 端口——「尽力而为」，不算启动错误；
 * - Tauri 窗口 API **按需加载**：窗口模块只在真壳里用得到，静态导入会让浏览器构建也把
 *   它拉进依赖图，故这里收口成全仓统一的动态 `import`。
 */
import {
  connectWsBridge,
  createWsHostPlatform,
  createWsProjectFilesPort,
  createWsSavePort,
  type FullscreenWindowLike,
} from "@lingfan/adapters";
import type { ProjectFilesPort, SavePort } from "@lingfan/engine";

/** WS dev 通道连接超时（毫秒）缺省值：宿主未运行 = 快速失败，维持 web 端口 */
export const WS_BRIDGE_TIMEOUT_MS = 1500;

/** dev 通道接入结果的落点：端口接上就替换，平台事实随后取 */
export interface WsDevSink {
  /** 宿主的读工程 / 存档端口（两个一起换上） */
  usePorts(filesPort: ProjectFilesPort, savePort: SavePort): void;
  /** 宿主平台事实（`host_platform` 命令的返回值） */
  usePlatform(platform: string): void;
}

/** dev 通道接入参数（超时可换；缺省 = 现状） */
export interface WsDevChannelOptions {
  /** 连接超时（毫秒） */
  wsBridgeTimeoutMs?: number;
}

/**
 * 尝试接入宿主的 WS dev 通道：接上则经 `sink` 提交端口与平台事实，失败只记一条诊断。
 *
 * 只由 dev 构建的浏览器形态调用。宿主的两个端口工厂是纯包装（只造对象、不发请求），
 * 因此「端口提交」先于「平台取值」；平台取值失败时不回退已提交的端口——那正是宿主
 * 能力部分可用的既有语义。
 */
export async function connectWsDevChannel(
  sink: WsDevSink,
  options: WsDevChannelOptions = {},
): Promise<void> {
  try {
    const bridge = await connectWsBridge({
      timeoutMs: options.wsBridgeTimeoutMs ?? WS_BRIDGE_TIMEOUT_MS,
    });
    sink.usePorts(createWsProjectFilesPort(bridge), createWsSavePort(bridge));
    sink.usePlatform(await createWsHostPlatform(bridge));
    console.info("[lfen-ws] 浏览器已接入宿主 dev 通道（读工程/存档/平台）");
  } catch {
    console.info(
      "[lfen-ws] 宿主 WS 通道不可用，维持 web 端口（静态根 + webStorage）",
    );
  }
}

/**
 * 取当前 Tauri 窗口（按需加载窗口模块）。只由真壳形态调用——浏览器形态走另一分支，
 * 不触碰 `@tauri-apps`。返回面按适配器的 `FullscreenWindowLike` 收窄：调用方只需要
 * 「能切全屏的窗口」这一点能力，窗口模块的其余类型面不必扩散出去。
 */
export async function loadTauriWindow(): Promise<FullscreenWindowLike> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

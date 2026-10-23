/**
 * Tauri 宿主桥接的唯一出口：`invoke`（调 Rust 命令）与 `listen`（订阅宿主事件）
 * 的契约、装配入口，以及两者的缺省实现。
 *
 * 为什么桥由组合根装进来，而不是本文件自己去取 Tauri 运行时：本包是给外部工程消费的
 * 源码包，本身**不得出现 `@tauri-apps/api` 的模块名**。两条路都被堵死了——
 * 写字面量说明符，打包器（Rollup 与基于它的 vite / uni）会把它静态解析进依赖图，
 * 浏览器与小程序形态明明走不到桌面分支，却在构建期因解析失败而崩；
 * 写成变量说明符，打包器放过它，但产物里留下一个裸模块名，WebView 执行时抛
 * `TypeError: Module name ... does not resolve to a valid URL`——整个前端入口挂掉。
 * 两全的做法只有一条：模块名留在**宿主组合根**（它有这个依赖，也只在壳里跑），
 * 由它把两个函数装进来；本包只经契约调用，对 Tauri 运行时的存在与否一无所知。
 *
 * 怎么用：组合根在装配任何原生端口**之前**调一次 `installTauriBridge`；
 * 各实现工厂把 `TauriInvoke` 作为可选参数（缺省 = `defaultInvoke`），
 * 测试传契约替身即可，完全不依赖 Tauri 运行时。
 */

/** invoke 函数契约（Tauri 公共 API 形状；测试替身按此契约实现） */
export type TauriInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

/** 事件监听契约（Tauri 公共 API 形状；测试替身按此契约实现） */
export type TauriListen = (
  event: string,
  handler: () => void,
) => Promise<() => void>;

/** 宿主桥：组合根装进来的两个函数（形状与 `@tauri-apps/api` 的同名导出一致） */
export interface TauriBridge {
  invoke: TauriInvoke;
  listen: TauriListen;
}

/**
 * 桥未装配就发起原生调用——组合根漏了 `installTauriBridge`，或该形态本不该调原生端口。
 * 类型化而非裸 `Error`：调用方可据此把「没壳」与「壳坏了」区分开（前者是配置问题，
 * 后者是运行时故障），用户可见层再转成可读提示。
 */
export class TauriBridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TauriBridgeError";
  }
}

/** 已装配的桥（null = 尚未装配，原生调用一律 fail-closed） */
let installed: TauriBridge | null = null;

/**
 * 装配宿主桥：由组合根在创建任何原生端口之前调用一次，重复调用以后装者为准
 * （热重载重建组合根时即为此形态，不留半新半旧的桥）。
 */
export function installTauriBridge(bridge: TauriBridge): void {
  installed = bridge;
}

/** 取已装配的桥；未装配即抛（fail-closed，不返回会静默失败的假实现） */
function requireBridge(): TauriBridge {
  if (installed === null) {
    throw new TauriBridgeError(
      "Tauri 桥未装配：组合根须在创建原生端口前调用 installTauriBridge",
    );
  }
  return installed;
}

/** 缺省 invoke：转调组合根装进来的桥（测试注入替身，不依赖 Tauri 运行时） */
export const defaultInvoke: TauriInvoke = async <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => requireBridge().invoke<T>(command, args);

/** 缺省 listen：订阅宿主事件并返回退订句柄（回调不关心事件负载） */
export const defaultListen: TauriListen = async (
  event,
  handler,
): Promise<() => void> => requireBridge().listen(event, handler);

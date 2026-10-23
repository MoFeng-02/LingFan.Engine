/**
 * Tauri 宿主桥接的唯一出口：`invoke`（调 Rust 命令）与 `listen`（订阅宿主事件）
 * 的类型契约，以及两者的缺省实现。
 *
 * 为什么单独成文件：原生适配器（工程供给、写回、加密资源、偏好、多语言、屏幕方向）
 * 都要经 invoke 与 Rust 打交道。契约与缺省实现集中在这里，各实现只依赖这一处，
 * 不再各自复制一份，也不再互相引用彼此的实现文件。
 *
 * 怎么用：各实现工厂把 `TauriInvoke` 作为可选参数（缺省 = `defaultInvoke`），
 * 测试传契约替身即可，完全不依赖 Tauri 运行时。
 *
 * 注意：缺省实现是**动态** import `@tauri-apps/api/core` 与 `@tauri-apps/api/event`——
 * 浏览器与无壳形态下这两个模块不存在，静态导入会在装载期直接失败；
 * 动态导入只在真正发起调用时才需要它们。
 *
 * 注意：import 的说明符必须是**变量**而不能是字面量。打包器（Rollup 与基于它的
 * vite / uni）会静态解析动态 import 的字面量说明符，把它当作真实依赖塞进图里：
 * 那时工程若没把 `@tauri-apps/api` 装到顶层，构建会以
 * `Rollup failed to resolve import "@tauri-apps/api/core"` 直接失败——明明只在
 * 桌面形态才会走到的分支，却让浏览器与小程序形态构建不起来。
 * 写成变量后打包器无法静态解析，只在运行时按需装载；`@vite-ignore` 让 vite
 * 连这条告警也不再输出。
 */

/** `@tauri-apps/api` 的两个子路径（写成变量，见文件头「说明符必须是变量」） */
const CORE_MODULE = "@tauri-apps/api/core";
const EVENT_MODULE = "@tauri-apps/api/event";

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

/** 缺省 invoke：取 Tauri 运行时后转调（组合根无需注入，测试注入替身） */
export const defaultInvoke: TauriInvoke = async <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  const { invoke } = (await import(/* @vite-ignore */ CORE_MODULE)) as {
    invoke: <R>(command: string, args?: Record<string, unknown>) => Promise<R>;
  };
  return invoke<T>(command, args);
};

/** 缺省 listen：订阅宿主事件并返回退订句柄（回调不关心事件负载） */
export const defaultListen: TauriListen = async (event, handler) => {
  const { listen } = (await import(/* @vite-ignore */ EVENT_MODULE)) as {
    listen: (event: string, onEvent: () => void) => Promise<() => void>;
  };
  return listen(event, () => handler());
};

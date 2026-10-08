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

/** 缺省 invoke：取 Tauri 运行时后转调（组合根无需注入，测试注入替身） */
export const defaultInvoke: TauriInvoke = async <T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
};

/** 缺省 listen：订阅宿主事件并返回退订句柄（回调不关心事件负载） */
export const defaultListen: TauriListen = async (event, handler) => {
  const { listen } = await import("@tauri-apps/api/event");
  return listen(event, () => handler());
};

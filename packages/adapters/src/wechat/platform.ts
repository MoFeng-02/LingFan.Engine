/**
 * 微信小程序平台面：本包只声明「实现端口所用到的那一层」——宿主把 `wx` 对象（或其薄包装）
 * 注入进来，适配器代码因此不引用任何 `wx` 全局，单元测试注入假对象即可覆盖语义。
 *
 * 这里只描述平台提供什么，不含业务判断；平台没有的能力不要在这里假装有。
 */

/**
 * 同步键值存储面（`wx.setStorageSync` / `getStorageSync` / `removeStorageSync` / `getStorageInfoSync`）。
 * 注意缺省值语义与 `localStorage` 不同：**取不存在的键返回空串**（不是 null）。
 */
export interface WechatStorageLike {
  set(key: string, value: string): void;
  get(key: string): string;
  remove(key: string): void;
  /** 已存键全集（`getStorageInfoSync().keys` 形态；存档列表用） */
  keys(): readonly string[];
}

/**
 * 单个音频实例面（`wx.createInnerAudioContext()` 返回值用到的子集）。
 * `currentTime` 是只读播放位置（秒）；平台不提供该字段时按 0 处理。
 * `onEnded` 用来回收一次性实例（`se` 通道允许叠放，播完即销毁）；注册式，后注册替换先注册。
 */
export interface WechatAudioContextLike {
  /** 资源地址（包内路径或临时地址） */
  src: string;
  /** 0..1 */
  volume: number;
  loop: boolean;
  readonly currentTime?: number;
  play(): void;
  stop(): void;
  seek(position: number): void;
  destroy(): void;
  onEnded?(callback: () => void): void;
}

/**
 * 视频呈现面：小程序的 `video` 是声明式组件（由宿主建节点、绑 `bindended`），
 * 所以本包只推状态，不自己创建播放器——宿主实现本面即为「把状态落到那个组件上」。
 */
export interface WechatVideoSurfaceLike {
  show(request: {
    url: string;
    volume: number;
    loop: boolean;
    zIndex?: number;
  }): void;
  hide(): void;
  pause(): void;
  resume(): void;
  seek(seconds: number): void;
  /** 注册自然播放结束回调（组件的 `bindended` 转发）；后注册替换先注册 */
  onEnded(callback: () => void): void;
}

/** 帧面（`canvas.requestAnimationFrame` 形态；小程序侧还有全局 rAF，由宿主决定注入哪个） */
export interface WechatCanvasFrameLike {
  requestAnimationFrame(callback: (now: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

/**
 * 用户目录文件面（下载或写入过的资源；包内静态资源不经过这里）。
 * 小程序的用户目录路径不能直接当播放地址用，需要经文件系统换成可访问地址。
 */
export interface WechatFileSystemLike {
  exists(path: string): boolean;
  url(path: string): string;
  release(url: string): void;
}

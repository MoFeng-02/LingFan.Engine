/**
 * 本地宿主契约：编辑器界面与 `apps/editor/server` 之间的线上形状。
 *
 * 为什么放在契约层：一次打包请求要在两侧各写一遍——浏览器侧发出、Node 侧应答，
 * 形状若各写一份，改了一边忘了另一边只会等到运行时才发现。
 * Node 侧以 `import type` 取用本文件：类型在构建期被擦除，两侧不产生运行期依赖。
 *
 * **本模块只有类型**：全是 `interface` / `type`，没有任何运行期导出（常量、函数、类都没有）。
 * 这样即使哪天有人把它写成裸 `import`，也拖不进任何代码——边界靠模块本身守住，
 * 不靠调用方自觉。
 *
 * 注意：这里只写「线上传什么」，不写校验规则——一个请求是否被接受由宿主侧判定。
 */

/** 宿主能力清单（宿主启动时打印并由界面读取；`pack` / `watch` 为假时对应功能如实置灰） */
export interface HostCapabilities {
  /** 恒为真：这份清单只由本地宿主产出 */
  readonly local: true;
  readonly openExternal: true;
  readonly pack: boolean;
  readonly watch: boolean;
  /** 访问宿主端点所需的令牌 */
  readonly token: string;
  readonly port: number;
  readonly root: string;
}

/** 打包请求（工程根与输出根都用绝对路径；`force` 会清空输出目录） */
export interface PackRequest {
  readonly input: string;
  readonly output: string;
  readonly force?: boolean;
  readonly strict?: boolean;
  readonly dist?: string;
}

/** 打包结果（原样回传：失败就是失败，`stderr` 不美化） */
export interface PackResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** 热重载的监视状态（界面只比较 `revision` 的大小，不关心它的绝对值） */
export interface WatchStatus {
  /** 变更计数（单调递增） */
  readonly revision: number;
  /** 监视是否真的在跑；不为真即「热重载不可用」，界面据此如实显示 */
  readonly watching: boolean;
  /** 被监视的根（仅供显示） */
  readonly root?: string;
}

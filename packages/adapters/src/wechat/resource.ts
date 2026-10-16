/**
 * ResourcePort 小程序实现：逻辑资源路径 → 可访问地址。两段来源与 Web 一致的地方在于
 * 复用同一份路径规范化（拒绝空段与 `..` 逃逸，见 `../resources/resourcePort.ts`）：
 * - 包内资源（`/Resources/Audio/x.mp3` 一类）：按包根直接拼，不需要文件面；
 * - 用户目录文件（下载或写入过的）：经文件面换成可访问地址，并在 `release` 时释放。
 * 小程序的包体有体积上限，动态资源只能落在用户目录，所以这两段是真实存在的两条路。
 */
import type { ResourcePort } from "@lingfan/engine";
import { normalizeResourceId } from "../resources/resourcePort.ts";
import type { WechatFileSystemLike } from "./platform.ts";

/** 包内资源根：包内文件以 `/` 开头即包根 */
const PACKAGE_ROOT = "/";
/** 用户目录根（`wx.env.USER_DATA_PATH` 形态）：用户目录里的资源拼在这个前缀下 */
const USER_ROOT = "usr/";

/** 资源端口的装配参数 */
export interface WechatResourceOptions {
  /** 包内资源根；缺省 "/"（包根） */
  packageRoot?: string;
  /** 用户目录根；缺省 "usr/"（与 `wx.env.USER_DATA_PATH` 的形态对应） */
  userRoot?: string;
}

/**
 * 造一个资源端口（小程序）。
 * @param fileSystem 用户目录文件面；**不给则只走包内资源**（纯包内故事不需要它）
 * @param options 两个根的拼法；缺省包根 `/` + 用户目录 `usr/`
 */
export function createWechatResourcePort(
  fileSystem?: WechatFileSystemLike,
  options?: WechatResourceOptions,
): ResourcePort {
  const packageRoot = options?.packageRoot ?? PACKAGE_ROOT;
  const userRoot = options?.userRoot ?? USER_ROOT;
  return {
    async resolve(id: string): Promise<string> {
      const relative = normalizeResourceId(id);
      if (fileSystem !== undefined) {
        const userPath = `${userRoot}${relative}`;
        if (fileSystem.exists(userPath)) return fileSystem.url(userPath);
      }
      return `${packageRoot}${relative}`;
    },
    release(url: string): void {
      // 包内地址没有句柄，文件面实现应忽略不认识的地址（只有它自己发过的地址需要回收）
      fileSystem?.release(url);
    },
  };
}

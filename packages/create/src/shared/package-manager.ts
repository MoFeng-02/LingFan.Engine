/**
 * 包管理器识别。
 *
 * 为什么需要识别：生成器是给**别人**用的工具，不能假定对方用 pnpm。安装依赖与
 * 打印后续步骤都要跟随调用方的包管理器——`npm create` 就该给出 npm 的命令，
 * `pnpm create` 给出 pnpm 的。本仓内部开发固定 pnpm 是仓库约定，不是产物约定。
 *
 * 识别依据是 npm 生态的既定事实 `npm_config_user_agent`（`npm create` /
 * `pnpm create` / `yarn create` / `bun create` 都会设置它）。拿不到时退回
 * `npm_execpath` 的文件名，再拿不到按 npm 处理——这是最不会误导人的缺省，
 * 因为 npm 的命令形式（`npm run dev`）在 pnpm/yarn 下也基本能跑。
 */

/** 生成器认得的包管理器；不认识的都按 npm 处理 */
export type PackageManagerId = "npm" | "pnpm" | "yarn" | "bun";

/** 一个包管理器的命令写法 */
export interface PackageManager {
  readonly id: PackageManagerId;
  /** 跑一个 `package.json` 脚本的写法，如 `dev` / `run dev` */
  readonly script: string;
  /** 安装依赖的写法（四家都是 `install`，保留字段是为了日后出现例外时有落点） */
  readonly install: string;
}

const MANAGERS: Readonly<Record<PackageManagerId, PackageManager>> = {
  npm: { id: "npm", script: "run dev", install: "install" },
  pnpm: { id: "pnpm", script: "dev", install: "install" },
  yarn: { id: "yarn", script: "dev", install: "install" },
  bun: { id: "bun", script: "run dev", install: "install" },
};

const KNOWN = ["npm", "pnpm", "yarn", "bun"] as const;

/** 把一段文本折成包管理器名：去扩展名、去版本尾缀 */
function normalize(segment: string): PackageManagerId | undefined {
  const name = segment
    .toLowerCase()
    .replace(/\.(?:c|m)?js$|\.exe$/u, "")
    .split("@")[0];
  return KNOWN.find((id) => id === name);
}

/**
 * 从 `user-agent` 或可执行路径里认出包管理器。
 *
 * 两种输入形态不同，故首段与末段都试：`user-agent` 是
 * `pm/版本 平台/…`（首段有名），可执行路径是 `/usr/local/bin/pm.cjs`
 * （末段有名，首段是空串或盘符）。取第一个认得出的。
 */
export function parsePackageManager(
  hint: string | undefined,
): PackageManagerId | undefined {
  if (hint === undefined) return undefined;
  const segments = hint.split(/[/\\]/u).filter((part) => part !== "");
  for (const segment of [segments[0], segments[segments.length - 1]]) {
    if (segment === undefined) continue;
    const found = normalize(segment);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 当前进程由哪个包管理器发起。
 *
 * 优先级：`npm_config_user_agent`（最权威，四家都会设）→ `npm_execpath`
 * （垫片被直接 `node` 调用时的退路）→ npm（缺省）。
 */
export function detectPackageManager(env: {
  readonly userAgent?: string | undefined;
  readonly execPath?: string | undefined;
}): PackageManager {
  const id =
    parsePackageManager(env.userAgent) ??
    parsePackageManager(env.execPath) ??
    "npm";
  return MANAGERS[id];
}

/** 从真实进程环境里取一个 */
export function currentPackageManager(): PackageManager {
  return detectPackageManager({
    userAgent: process.env.npm_config_user_agent,
    execPath: process.env.npm_execpath,
  });
}

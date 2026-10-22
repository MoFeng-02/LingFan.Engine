/**
 * npm registry 版本查询。
 *
 * 存在的理由：模板里记录的引擎版本是模板发布时的快照，装到新工程里可能已经落后。
 * 生成时查一次当前最新版，把具体版本号钉进工程清单，让新工程一上来就是新的，
 * 同时又不写 `latest` 标签——标签每次安装解析结果不同，构建会不可重现。
 *
 * 网络不可用时**不失败**：退回模板记录的版本并给出提示。生成一个工程不需要联网，
 * 拉不到最新版不该让整件事失败。
 */
import { caretRange } from "../shared/index.ts";

/** 一个包的解析结果：`version` 是 registry 上的最新稳定版 */
export interface ResolvedVersion {
  readonly name: string;
  readonly version: string;
}

/** 查询超时：生成是交互式操作，宁可退回旧版本也不要让人干等 */
const TIMEOUT_MS = 8000;

/** 失败重试一次：并发查几个包时偶发单个连接被对端重置，重试即可，不必让使用者看见 */
const ATTEMPTS = 2;

/** 并发上限：一次甩出十几个连接会让 registry 直接限流，分批查反而快 */
const CONCURRENCY = 3;

/** registry 地址：允许经环境变量覆盖（企业内网镜像、离线代理） */
function registryBase(): string {
  const configured = process.env.LINGFAN_CREATE_REGISTRY;
  return (
    configured !== undefined && configured !== ""
      ? configured
      : "https://registry.npmjs.org"
  ).replace(/\/+$/, "");
}

/**
 * 查询单个包的 `dist-tags.latest`。
 *
 * 只取标签页而不是完整文档（`/<pkg>/latest` 更小），并显式请求 `dist-tags`：
 * 完整文档在 `react` 这类包上是几 MB，生成器没必要为拿一个版本号付这个代价。
 *
 * 失败重试一次：并发查询时偶发连接被对端重置，重试的代价远小于「某个包的版本
 * 悄悄留在模板旧值」——那种结果看不出来，却让产物自相矛盾。
 */
export async function fetchLatestVersion(
  name: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${registryBase()}/${name}/latest`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { version?: unknown };
      if (typeof body.version === "string") return body.version;
    } catch {
      // 断网、超时、DNS 失败、JSON 损坏都走这里：还有一次机会，然后按「拿不到」处理
    } finally {
      clearTimeout(timer);
    }
  }
  return undefined;
}

/**
 * 批量查询：分批并发，任一失败不影响其它。
 *
 * 返回表只含查到的项——调用方拿模板记录的版本兜底，因此「缺席」比「空串」更好判。
 */
export async function resolveVersions(
  names: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let start = 0; start < names.length; start += CONCURRENCY) {
    const batch = names.slice(start, start + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(
        async (name) => [name, await fetchLatestVersion(name)] as const,
      ),
    );
    for (const [name, version] of settled) {
      if (version !== undefined) out.set(name, version);
    }
  }
  return out;
}

/**
 * 把查到的版本合进工程清单的依赖表。
 *
 * 规则：清单里有、也查到了 → 换成 `^最新`；查不到 → 保留模板记录的原值不动。
 * 只改清单里已有的键，不新增依赖——依赖集合由模板决定，生成器不是包管理器。
 */
export function applyResolvedVersions(
  dependencies: Readonly<Record<string, string>>,
  resolved: ReadonlyMap<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(dependencies)) {
    const latest = resolved.get(name);
    out[name] = latest === undefined ? range : caretRange(latest);
  }
  return out;
}

/**
 * 工程来源（远端）：清单与故事从工程接口取，媒体资源按同一个基址拼地址。
 *
 * 小程序包体只装代码——故事与素材都是内容，走 HTTP 从服务端取，改内容不必重新提审发版。
 * 基址只有一处（`DEFAULT_PROJECT_BASE_URL`，可用环境变量 `VITE_PROJECT_BASE_URL` 覆盖）：
 * - 工程接口 = 基址 + `project`：一次返回 `{ manifest, stories }`（故事原文，解析归引擎）；
 * - 资源地址 = 基址 + 资源 id：`Audio/x.mp3` → `<基址>/Audio/x.mp3`（静态托管形态）。
 *
 * 本文件不碰平台全局：取件面由组合根注入（小程序用 `uni.request` 包的那个），
 * 所以 Node 下能直接单测。
 */
import {
  createHttpProjectFilesPort,
  createStaticResourcePort,
  type HttpFetch,
} from "@lingfan-engine/adapters";
import type { ProjectFilesPort, ResourcePort } from "@lingfan-engine/core";

/** 缺省基址：与本地开发服务（`scripts/serve-project.mjs`）的端口一致 */
export const DEFAULT_PROJECT_BASE_URL = "http://127.0.0.1:5273/";

/** 工程接口路径（相对基址） */
export const PROJECT_ENDPOINT_PATH = "project";

/**
 * 规范化基址：必须是 http(s) 绝对地址、以 `/` 结尾（资源 id 直接拼上来）。
 * 形状不对就抛——配错了要在启动时暴露，不能拼出一串坏地址到播放阶段。
 */
export function normalizeProjectBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`工程基址必须是 http(s) 绝对地址：${baseUrl}`);
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/** 读运行期基址：环境变量优先，缺省指本地开发服务 */
export function resolveProjectBaseUrl(): string {
  const env = import.meta.env as
    { VITE_PROJECT_BASE_URL?: unknown } | undefined;
  const fromEnv = env?.VITE_PROJECT_BASE_URL;
  const value = typeof fromEnv === "string" ? fromEnv.trim() : "";
  return normalizeProjectBaseUrl(
    value === "" ? DEFAULT_PROJECT_BASE_URL : value,
  );
}

/** 工程接口地址 */
export function projectEndpointUrl(
  baseUrl: string = resolveProjectBaseUrl(),
): string {
  return `${normalizeProjectBaseUrl(baseUrl)}${PROJECT_ENDPOINT_PATH}`;
}

/**
 * 造远端工程供给端口：清单与故事都从工程接口取。
 * @param options 取件面（必给，平台能力由组合根注入）与基址（缺省读运行期配置）
 */
export function createRemoteProjectFilesPort(options: {
  fetch: HttpFetch;
  baseUrl?: string;
}): ProjectFilesPort {
  return createHttpProjectFilesPort({
    url: projectEndpointUrl(options.baseUrl),
    fetch: options.fetch,
  });
}

/**
 * 造远端资源端口：故事里的裸资源 id 拼到基址下（`Audio/x.mp3` → `<基址>/Audio/x.mp3`）。
 * 路径规范化沿用资源域的同一份规则（空段与 `..` 逃逸在信任边界上拒绝）。
 */
export function createRemoteResourcePort(
  baseUrl: string = resolveProjectBaseUrl(),
): ResourcePort {
  return createStaticResourcePort(normalizeProjectBaseUrl(baseUrl));
}

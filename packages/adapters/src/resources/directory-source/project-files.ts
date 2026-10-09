/**
 * 工程文件端口（两类取径共用）。
 *
 * 加密形态在**读取任何文件之前**统一识别并拒绝：逐个路径在循环里抛会把
 * 「工程形态问题」报成「某个文件的问题」，而且已白读一批文件。
 * 缺少清单是唯一可降级的情形（合成最小清单并把降级事实显式上交），
 * 清单存在但损坏属于结构问题，照旧 fail-closed；连 `Stories/` 都没有则没有可打开的内容，
 * 同样拒绝——不像 Tauri 供给那样隐式改读磁盘：编辑器把「打开工程」当快照。
 */
import {
  MANIFEST_FILE,
  STORIES_DIR,
  synthesizeDegradedManifest,
  type DegradedOpen,
  type ProjectFileSource,
  type ProjectFilesPort,
} from "@lingfan/engine";
import {
  detectEncryptedProject,
  encryptedProjectMessage,
} from "../encryptedProject";

/** 一次装载的结果：清单对象、逻辑路径 → 故事原文，以及「缺清单」时的降级回执 */
interface LoadedProject {
  manifest: unknown;
  stories: Map<string, string>;
  degraded: DegradedOpen | undefined;
}

/**
 * 读一遍工程内容。先判加密形态（命中就直接拒绝，不去逐个读文件），再定故事文件：
 * 没有 `Stories/` 就没有可打开的内容，照旧拒绝；缺清单是唯一可降级的情形，
 * 合成最小清单并把降级事实一起返回。清单存在但不是合法 JSON 属结构损坏，照旧抛错。
 */
async function readProject(source: ProjectFileSource): Promise<LoadedProject> {
  const paths = await source.paths();
  // 加密形态前置识别（唯一判定点）：读取任何文件之前拒绝
  const encrypted = detectEncryptedProject(paths);
  if (encrypted.encrypted) {
    throw new Error(encryptedProjectMessage(source.name, encrypted));
  }
  const hasManifest = paths.includes(MANIFEST_FILE);
  const storyPaths = paths.filter((path) => path.startsWith(`${STORIES_DIR}/`));
  if (storyPaths.length === 0) {
    // 只降级「缺清单」这一种：连 Stories/ 都没有 = 没有可打开的内容，照旧 fail-closed
    throw new Error(
      hasManifest
        ? `资源根（${source.name}）缺少 ${STORIES_DIR}/ 目录`
        : `资源根（${source.name}）缺少 ${MANIFEST_FILE} 且没有 ${STORIES_DIR}/ 目录：没有可打开的内容`,
    );
  }
  const stories = new Map<string, string>();
  for (const path of storyPaths) {
    stories.set(path, await source.text(path));
  }
  if (!hasManifest) {
    // 降级：合成最小清单（formatVersion/id/entry），降级事实显式上交（端口 `degraded()`）
    const { manifest, degraded } = synthesizeDegradedManifest(source.name, stories);
    return { manifest, stories, degraded };
  }
  const raw = await source.text(MANIFEST_FILE);
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (error: unknown) {
    // 清单**存在但损坏** = 结构问题，照旧 fail-closed（可降级的只有「缺失」）
    throw new Error(`${MANIFEST_FILE} 不是合法 JSON：${String(error)}`);
  }
  return { manifest, stories, degraded: undefined };
}

/**
 * `ProjectFilesPort` 实现：一次装载 memo（失败粘滞 fail-closed，不降级空工程——
 * 与 Tauri 供给同语义；编辑器把「打开工程」当快照，不隐式改读磁盘）。
 */
export function createSourceProjectFilesPort(
  source: ProjectFileSource,
): ProjectFilesPort {
  let loaded: Promise<LoadedProject> | null = null;
  const load = (): Promise<LoadedProject> => {
    loaded ??= readProject(source);
    return loaded;
  };
  return {
    async manifest(): Promise<unknown> {
      return (await load()).manifest;
    },
    async stories(): Promise<Map<string, string>> {
      return new Map((await load()).stories);
    },
    async degraded(): Promise<DegradedOpen | undefined> {
      // 与 manifest()/stories() 共享同一次装载 memo（幂等）；缺清单 = 合成回执，否则 undefined
      return (await load()).degraded;
    },
  };
}

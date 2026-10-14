/**
 * 资源供给与写回链路的用户可见文案表：宿主可按方法覆盖（`Partial` 深合并到缺省）。
 *
 * 为什么集中：资源根定位、加密工程拒绝、缺目录拒绝、写权限拒绝这批文案分布在
 * 四个模块，宿主要换产品词表得逐模块找；集中一张表 + 缺省实现即现文案，
 * 宿主不传 texts 时行为不变。改缺省措辞前先确认没有测试断言其内容
 * （`tests/adapters/resources/` 有逐字锚定）。
 */
import { MANIFEST_FILE, STORIES_DIR } from "@lingfan/engine";
import {
  encryptedProjectMessage,
  type EncryptedProjectFinding,
} from "./encryptedProject";

/** 资源供给与写回链路的用户可见文案（宿主可按方法覆盖） */
export interface ResourceTexts {
  /** 句柄取径：所选目录内未找到清单与故事目录（引导选资源根） */
  rootLocateHandleMissing(dirName: string): string;
  /** 路径取径：同深多个清单（无法判定资源根，引导直接选资源根） */
  rootLocateMultipleManifests(first: string, second: string): string;
  /** 路径取径：所选目录内未找到清单与故事目录（引导选资源根） */
  rootLocatePathsMissing(): string;
  /** 路径取径：发现多个故事目录（无法判定资源根，引导直接选资源根） */
  rootLocateMultipleStoryRoots(list: string): string;
  /** 加密工程拒绝（唯一判定点的可操作文案） */
  encryptedProject(root: string, finding: EncryptedProjectFinding): string;
  /** 资源根缺故事目录（有清单形态） */
  missingStoriesDir(rootName: string): string;
  /** 资源根缺清单且缺故事目录（没有可打开的内容） */
  missingManifestAndStories(rootName: string): string;
  /** 未获写权限（权限询问被拒 / 建可写流被拒同一句） */
  writePermissionDenied(): string;
}

/** 缺省实现即资源供给层的缺省文案：不传 texts 时行为不变 */
export const defaultResourceTexts: ResourceTexts = {
  rootLocateHandleMissing: (dirName) =>
    `所选目录（${dirName}）内未找到 ${MANIFEST_FILE} 或 ${STORIES_DIR}/：请选择工程资源根（含 ${MANIFEST_FILE} 或 ${STORIES_DIR}/ 的目录）`,
  rootLocateMultipleManifests: (first, second) =>
    `发现多个 ${MANIFEST_FILE}（${first}、${second}）：请直接选择工程资源根目录`,
  rootLocatePathsMissing: () =>
    `所选目录内未找到 ${MANIFEST_FILE} 或 ${STORIES_DIR}/：请选择工程资源根（含 ${MANIFEST_FILE} 或 ${STORIES_DIR}/ 的目录）`,
  rootLocateMultipleStoryRoots: (list) =>
    `发现多个 ${STORIES_DIR}/ 目录（${list}）：请直接选择工程资源根目录`,
  encryptedProject: (root, finding) => encryptedProjectMessage(root, finding),
  missingStoriesDir: (rootName) =>
    `资源根（${rootName}）缺少 ${STORIES_DIR}/ 目录`,
  missingManifestAndStories: (rootName) =>
    `资源根（${rootName}）缺少 ${MANIFEST_FILE} 且没有 ${STORIES_DIR}/ 目录：没有可打开的内容`,
  writePermissionDenied: () =>
    "未获得写入权限：请重新点击「打开工程」选择该目录，并在浏览器询问时选择「允许编辑」",
};

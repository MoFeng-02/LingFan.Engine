import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_FILE } from "@lingfan/engine";
import { StoryBuildError } from "./errors";

/**
 * 读取工程清单（`<root>/<resourcesDir>/project.json`）。
 * 清单是工程事实（entry/defines/shell），不归 TS 源管：缺文件与非法 JSON 都 fail-closed，
 * 文案带实际路径便于作者定位自己漏了什么。
 */
export function readManifest(root: string, resourcesDir: string): unknown {
  const manifestPath = join(root, resourcesDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new StoryBuildError(
      `${resourcesDir}/${MANIFEST_FILE} 不存在——工程清单（entry/defines/shell）不归 TS 源管，请先建工程清单`,
    );
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  try {
    return JSON.parse(manifestText);
  } catch (error) {
    throw new StoryBuildError(
      `${resourcesDir}/${MANIFEST_FILE} 不是合法 JSON：${String(error)}`,
    );
  }
}

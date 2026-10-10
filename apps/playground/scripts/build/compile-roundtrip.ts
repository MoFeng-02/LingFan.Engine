import {
  assembleProject,
  MANIFEST_FILE,
  serializeProject,
  type SerializedProject,
  type Story,
} from "@lingfan/engine";
import { StoryBuildError } from "./errors";

/**
 * 编译：`serializeProject` = 编辑器写回同一条布局规则
 * （单列拆分 + 清单托管键更新 + 非托管键保真）。
 */
export function compileStory(story: Story, manifest: unknown): SerializedProject {
  return serializeProject(story, manifest);
}

/**
 * 往返自检（编译期互锁）：产物重组回 story，再序列化必须逐字节幂等。
 * 不幂等说明「序列化 ↔ 组装」两条规则出现了分叉——这会让编辑器每次保存都漂移，
 * 故构建期直接拦下（报第一个不一致的键名）。
 */
export function assertRoundTrip(serialized: SerializedProject): void {
  const productManifestText = serialized.files.get(MANIFEST_FILE);
  if (productManifestText === undefined) {
    throw new StoryBuildError(
      `编译产物缺 ${MANIFEST_FILE}（serializeProject 契约破坏）`,
    );
  }
  // assembleProject 的 files = 故事文件集（不含清单）；清单单独走 manifest 参数
  const columnFiles = new Map(serialized.files);
  columnFiles.delete(MANIFEST_FILE);
  const rebuilt = assembleProject(JSON.parse(productManifestText), columnFiles);
  const recheck = serializeProject(rebuilt, JSON.parse(productManifestText));
  for (const key of serialized.files.keys()) {
    if (recheck.files.get(key) !== serialized.files.get(key)) {
      throw new StoryBuildError(
        `编译往返自检失败（serialize → assemble → serialize 不幂等）：${key}`,
      );
    }
  }
}

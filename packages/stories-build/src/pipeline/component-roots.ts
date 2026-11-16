import { join, posix } from "node:path";
import {
  SCENE_DIR_NAME,
  scanSceneRegistry,
  type SceneFileEntry,
} from "../scene/index.ts";
import { UI_DIR_NAME, scanUiRegistry, type UiFileEntry } from "../ui/index.ts";
import { createUiChannel } from "../compiler/story-compiler/graph/scan/ui-specifier.ts";
import { createSceneChannel } from "../compiler/story-compiler/graph/scan/scene-specifier.ts";
import type { ComponentChannel } from "../compiler/story-compiler/graph/scan/component-specifier.ts";
import type { AliasResolver } from "../compiler/story-compiler/graph/scan/alias.ts";

/**
 * 组件根：两个与源根平级的目录（`ui/` 是挂在列上的叠加层，`scenes/` 是列的身体）。
 *
 * 为什么要一次算全：目录位置、注册表扫描、说明符通道三者互为输入——通道要用注册表
 * 回答「这条具名导入指向哪个文件」，注册表要知道目录在哪，而两者都要相对生成物目录
 * 折成相对路径才能写进生成物。分开算会让同一个推导出现两处，改布局时漏一处。
 */
export interface ComponentRoots {
  /** 生成物里回指 UI 根的相对路径（默认布局 = `"../ui"`） */
  readonly uiRelFromGenerated: string;
  /** UI 根（绝对路径；越界依赖扫描的起点） */
  readonly uiRoot: string;
  /** UI 名注册表（`ui/<名>/<名>.<扩展名>`，按名字码元序） */
  readonly uiEntries: readonly UiFileEntry[];
  /** 生成物里回指场景根的相对路径（默认布局 = `"../scenes"`） */
  readonly sceneRelFromGenerated: string;
  /** 场景根（绝对路径） */
  readonly sceneRoot: string;
  /** 场景名注册表（`scenes/<名>/<名>.<扩展名>`，按名字码元序） */
  readonly sceneEntries: readonly SceneFileEntry[];
  /**
   * 两条组件通道（UI 在前、场景在后）。
   *
   * 顺序不是随意的：越界诊断由第一条通道收口（见各通道的 `ownsForeign`），
   * 判「这条说明符归谁」时先问到的必须是收口方。
   */
  readonly channels: readonly ComponentChannel[];
}

/**
 * 由工程布局推导出两个组件根与它们的两条通道。
 *
 * `sourcesDirName` 是相对工程根的源目录名（默认 `"src/Stories.src"`），两个组件根都是
 * 它父目录下的兄弟目录；`generatedRelRoot` 只为把绝对路径折成生成物里的相对写法。
 */
export function resolveComponentRoots(
  root: string,
  sourcesDirName: string,
  generatedRelRoot: string,
  sourcesDir: string,
  alias: AliasResolver | undefined,
): ComponentRoots {
  const sibling = (dirName: string): string =>
    posix.join(posix.dirname(sourcesDirName), dirName);

  // 生成物里一律写相对路径（不写别名）：别名是创作期便利，一旦进生成物就把宿主
  // 绑死在某个 tsconfig 上。默认布局下 `src/gen` 回指 `src/ui` 得 `"../ui"`。
  const uiRelRoot = sibling(UI_DIR_NAME);
  const uiRelFromGenerated = posix.relative(generatedRelRoot, uiRelRoot);
  const uiRoot = join(root, uiRelRoot);
  // 注册表只读文件系统、不依赖编译，故先于通道扫描：通道要用它回答具名导入指向谁。
  const uiEntries = scanUiRegistry(uiRoot);

  const sceneRelRoot = sibling(SCENE_DIR_NAME);
  const sceneRelFromGenerated = posix.relative(generatedRelRoot, sceneRelRoot);
  const sceneRoot = join(root, sceneRelRoot);
  const sceneEntries = scanSceneRegistry(sceneRoot);

  // 组件文件住在源根的兄弟目录，沙箱比模块导入宽一级；两个消费者（cell 搬运、
  // 故事编译）共用同一份判定，所以通道只在这里造一次。
  const uiChannel = createUiChannel(sourcesDir, alias, uiEntries);
  const sceneChannel = createSceneChannel(sourcesDir, alias, sceneEntries);

  return {
    uiRelFromGenerated,
    uiRoot,
    uiEntries,
    sceneRelFromGenerated,
    sceneRoot,
    sceneEntries,
    channels: [uiChannel.component, sceneChannel.component],
  };
}

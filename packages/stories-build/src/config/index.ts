/**
 * 配置域：工程清单与布局声明的读取、校验。
 *
 * 两者都是「先读工程声明，再决定后面怎么跑」的前置步骤，与源扫描
 * 分成两域是因为清单读的是 `project.json`、布局读的是 `Stories.src/config.ts`，
 * 校验规则各成一套，混在一个目录里只会让入口面变糊。
 */
export {
  CONFIG_FILE,
  assertSingleRootScript,
  parseFolders,
  parseStart,
  type StorySourceConfig,
} from "./story-config.ts";
export { readManifest } from "./manifest-read.ts";

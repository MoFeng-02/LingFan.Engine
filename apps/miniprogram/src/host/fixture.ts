/**
 * 内建演示工程：把示例故事随包打进小程序，宿主不依赖任何文件系统。
 *
 * 小程序的包内文件不能像浏览器那样按需 fetch，所以「工程文件供给」在这里就是一份
 * 编译期收集好的数据表：`import.meta.glob` 在构建期把 JSON 变成本模块里的常量，
 * 键换算成工程内的逻辑路径。
 *
 * 这里刻意**不用 `?raw`**：uni-app 的小程序构建把 JSON 交给 Vite 的 JSON 插件处理，
 * `?raw` 与 JSON 插件叠加时模块没有 default 导出（构建期报
 * `"default" is not exported by ...json?raw`）。改成按对象收集、再在供给口转回文本，
 * 效果与 `?raw` 相同，且两端（mp-weixin / H5）都成立。
 *
 * 逻辑路径必须与清单里的引用一致（`Stories/…` 开头），否则组装器找不到列文件。
 */
import type { ProjectFilesPort } from "@lingfan/engine";

/** 随包收集的故事文件（键为源码相对路径，值为已解析的 JSON） */
const STORY_SOURCES = import.meta.glob("../fixture/Stories/**/*.json", {
  eager: true,
}) as Record<string, unknown>;

/** 随包收集的工程清单 */
const MANIFEST_SOURCES = import.meta.glob("../fixture/project.json", {
  eager: true,
}) as Record<string, unknown>;

/** 逻辑路径的切点：源码路径里工程根之后就是工程内路径 */
const FIXTURE_MARK = "/fixture/";

/** 造演示工程的供给端口（清单与故事都来自包内数据） */
export function createFixtureProjectFilesPort(): ProjectFilesPort {
  const stories = new Map<string, string>();
  for (const [path, value] of Object.entries(STORY_SOURCES)) {
    stories.set(logicalPath(path), JSON.stringify(value));
  }
  const manifest = Object.values(MANIFEST_SOURCES)[0] ?? {};
  return {
    async manifest(): Promise<unknown> {
      return manifest;
    },
    async stories(): Promise<Map<string, string>> {
      return new Map(stories);
    },
  };
}

/** `../fixture/Stories/a/b.json` → `Stories/a/b.json` */
function logicalPath(path: string): string {
  const at = path.indexOf(FIXTURE_MARK);
  return at === -1 ? path : path.slice(at + FIXTURE_MARK.length);
}

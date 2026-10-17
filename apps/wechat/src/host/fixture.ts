/**
 * 内建演示工程：把示例故事随包打进小程序，宿主不依赖任何文件系统。
 *
 * 小程序的包内文件不能像浏览器那样按需 fetch，所以「工程文件供给」在这里就是一份
 * 编译期收集好的文本表：`?raw` 把 JSON 原样嵌进包，键换算成工程内的逻辑路径。
 * 逻辑路径必须与清单里的引用一致（`Stories/…` 开头），否则组装器找不到列文件。
 */
import type { ProjectFilesPort } from "@lingfan/engine";

/** 随包收集的故事文件（键为源码相对路径） */
const STORY_SOURCES = import.meta.glob("../fixture/Stories/**/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 随包收集的工程清单 */
const MANIFEST_SOURCES = import.meta.glob("../fixture/project.json", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 逻辑路径的切点：源码路径里工程根之后就是工程内路径 */
const FIXTURE_MARK = "/fixture/";

/** 造演示工程的供给端口（清单与故事都来自包内文本） */
export function createFixtureProjectFilesPort(): ProjectFilesPort {
  const stories = new Map<string, string>();
  for (const [path, text] of Object.entries(STORY_SOURCES)) {
    stories.set(logicalPath(path), text);
  }
  const manifestText = Object.values(MANIFEST_SOURCES)[0] ?? "{}";
  return {
    async manifest(): Promise<unknown> {
      return JSON.parse(manifestText) as unknown;
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

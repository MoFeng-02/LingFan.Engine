/**
 * 浏览器参考宿主的默认故事清单。
 *
 * 顺序即「首次进入时装载的故事」顺序，内容与磁盘上的故事文件一一对应（工程清单
 * `project.json` 另行声明目录结构，这里只列入口用到的故事）。
 */
export const STORIES: readonly string[] = [
  "Stories/chapter1/chapter1.story",
  "Stories/chapter2/chapter2.story",
  "Stories/chapter3/chapter3.story",
  "Stories/chapter4/vocab_tour.story",
];

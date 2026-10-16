/**
 * 浏览器参考宿主的默认故事清单。
 *
 * 顺序即「首次进入时装载的故事」顺序，内容与磁盘上的故事文件一一对应（工程清单
 * `project.json` 另行声明目录结构，这里只列入口用到的故事）。
 */
export const STORIES: readonly string[] = [
  "Stories/chapter1/inn.json",
  "Stories/chapter1/start.json",
  "Stories/chapter2/square.json",
  "Stories/chapter2/stage-demo.json",
  "Stories/chapter3/end.json",
  "Stories/chapter3/ts-power.json",
  "Stories/chapter4/tour-av.json",
  "Stories/chapter4/tour-ext.json",
  "Stories/chapter4/tour-flow.json",
  "Stories/chapter4/tour-guard.json",
  "Stories/chapter4/tour-save.json",
  "Stories/chapter4/tour-stage.json",
  "Stories/chapter4/tour-vars.json",
  "Stories/chapter4/tour.json",
];

/**
 * 浏览器文件下载：把一段文本作为文件交给用户（当前用于导出故事 JSON）。
 *
 * 做法：瞬时对象 URL + 未插入文档的 `<a download>`——点击不依赖元素在文档中，
 * 因此不产生额外 DOM 节点；URL 用完立即撤销，不长期占用内存。
 */
export function downloadJsonFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

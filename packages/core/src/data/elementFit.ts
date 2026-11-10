/**
 * 元素填充方式读数（纯函数，可测）。
 *
 * 为什么读法在引擎侧：填充方式（`stretch`）是**写在元素上的属性**，而真实画面由平台
 * 各自落地——浏览器写 `object-fit` / `background-size`，小程序 `<video>` 只有三个取值，
 * 桌面壳另有自己的呈现层。读同一份语义若由各宿主各写一遍，三份实现必然漂移，
 * 且漂移只在某个端上显形（最难查的一类不一致）。故读法收在引擎，宿主只把它包成
 * 惰性闭包注入端口即可。
 *
 * 本模块只吃入参（属性对象、元素表），不读平台、不抛错：属性值来自作者数据，
 * 写坏了回退缺省词，由编辑器侧诊断提示，不在渲染链上炸掉播放。
 */
import {
  DEFAULT_ELEMENT_FIT,
  ELEMENT_FITS,
  type ElementFit,
  type ElementInstance,
} from "../contracts/index.ts";

/**
 * 元素声明的填充方式：读 `props.stretch`，缺失 / 非字符串 / 不在词表内一律回缺省词。
 *
 * 「不在词表内也回缺省」是有意的：词表是闭合集合，把未知串透传下去只会让三端
 * 各自出现不同的兜底（浏览器忽略非法 `object-fit` 得到 `fill`，小程序落到组件缺省），
 * 那是比「统一回 cover」更难解释的行为。
 */
export function elementFitOf(props: Record<string, unknown>): ElementFit {
  const raw = props.stretch;
  return typeof raw === "string" &&
    (ELEMENT_FITS as readonly string[]).includes(raw)
    ? (raw as ElementFit)
    : DEFAULT_ELEMENT_FIT;
}

/**
 * 元素表里第一个视频元素的填充方式（没有视频元素时回缺省词）。
 *
 * 视频元素的实例在元素表里只是一个占位节点（真实 `<video>` 由端口直挂），
 * 端口的 `fit` 闭包每帧被重读，故这里按**前序**取第一个视频：多个视频元素同时存在时
 * 完整语义（各自填充）要等视频层支持多实例，一个端口一屏只有一个呈现层。
 * 递归覆盖 `children`，容器里的视频同样算数。
 */
export function videoFitOf(elements: readonly ElementInstance[]): ElementFit {
  const found = findVideo(elements);
  return found === undefined ? DEFAULT_ELEMENT_FIT : elementFitOf(found.props);
}

/** 深度优先找第一个 video 元素（无则 undefined） */
function findVideo(
  elements: readonly ElementInstance[],
): ElementInstance | undefined {
  for (const element of elements) {
    if (element.type === "video") return element;
    const nested = findVideo(element.children);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

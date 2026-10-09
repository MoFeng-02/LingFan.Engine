/**
 * 内建元素渲染器注册 —— **36 类型全覆盖**（唯一登记处）。
 *
 * 登记表是「类型名 → 渲染器」的完整映射，多个类型共用同一渲染器时并列书写，
 * 便于一眼核对覆盖面；分组注释与渲染器文件的分族保持一致。
 */
import type { ElementRegistry, ElementRenderer } from "../registry";
import { renderImage, renderImageButton, renderVideo } from "./media";
import { renderButton, renderCheckbox, renderProgress, renderSlider } from "./controls";
import {
  renderBorder,
  renderCanvas,
  renderContainer,
  renderGrid,
  renderScroll,
} from "./container";
import { renderSeparator, renderSpacer } from "./decoration";
import { renderText } from "./text";

/** 内建渲染器注册（宿主可在其后覆盖任意类型；未注册类型由宿主 fail-closed 上报） */
export function registerBuiltinElementRenderers(registry: ElementRegistry): void {
  const reg: Record<string, ElementRenderer> = {
    // 文本族 4
    text: renderText,
    dialog: renderText,
    narrator: renderText,
    speaker: renderText,
    // 交互族 3
    button: renderButton,
    choice: renderButton,
    imagebutton: renderImageButton,
    // 图像族 4
    image: renderImage,
    background: renderImage,
    portrait: renderImage,
    video: renderVideo,
    // 容器族 15
    panel: renderContainer,
    frame: renderContainer,
    window: renderContainer,
    dialogbox: renderContainer,
    choicebox: renderContainer,
    infobox: renderContainer,
    overlay: renderContainer,
    popup: renderContainer,
    vbox: renderContainer,
    hbox: renderContainer,
    grid: renderGrid,
    stack: renderContainer,
    stackpanel: renderContainer,
    canvas: renderCanvas,
    border: renderBorder,
    // 滚动族 3
    scroll: renderScroll,
    scrollviewer: renderScroll,
    viewport: renderScroll,
    // 进度族 5
    bar: renderProgress,
    vbar: renderProgress,
    progressbar: renderProgress,
    slider: renderSlider,
    checkbox: renderCheckbox,
    // 间隔族 2
    separator: renderSeparator,
    spacer: renderSpacer,
  };
  for (const [type, renderer] of Object.entries(reg)) {
    registry.register(type, renderer);
  }
}

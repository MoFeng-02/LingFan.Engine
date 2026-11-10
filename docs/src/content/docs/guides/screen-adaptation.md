---
title: 屏幕适配
description: 按设计基准像素写坐标，宿主把舞台等比缩放套进任何窗口；界面留在窗口坐标系里自适应，图片与视频按 stretch 决定怎么填满自己的框。
---

同一个工程会跑在手机、平板、桌面窗口和 4K 大屏上，尺寸差好几倍，但故事里写的坐标只有一套。屏幕适配要解决的就是这件事：**坐标写一次，显示在哪儿都对**。

## 三套坐标系，各管一段

| 坐标系   | 谁在用                               | 单位                      |
| -------- | ------------------------------------ | ------------------------- |
| 设计基准 | 故事里的元素、面板、对话框、字号     | 基准像素（缺省 1280×720） |
| 窗口     | 宿主界面：工具栏、通知、偏好面板     | 屏幕逻辑像素              |
| 设备像素 | 浏览器与操作系统自己处理，你不需要碰 | 物理像素                  |

你写给故事的所有坐标都在第一套里。窗口尺寸变化时，引擎算一个缩放比与偏移量，把整块舞台（元素层和扩展覆盖层）等比缩放后套进窗口；宿主界面不参与这次缩放，按窗口自己排版。

## 配置设计基准

写在 `project.json` 的 `shell.stage`，不写就是 1280×720、等比完整显示：

```json
{
  "shell": {
    "stage": {
      "width": 1280,
      "height": 720,
      "fit": "contain"
    }
  }
}
```

`width` / `height` 是设计基准，取值 160–16384（宽）与 90–16384（高）。换基准等于整场换坐标系，样式表不用动——同一份故事按 1920×1080 写就按 1920×1080 显示。

`fit` 决定舞台怎么装进窗口：

| 值        | 行为                                       | 适合                             |
| --------- | ------------------------------------------ | -------------------------------- |
| `contain` | 等比缩放到完整显示，多出的方向留边（缺省） | 想看到完整构图，能接受黑边       |
| `cover`   | 等比缩放到铺满，超出的部分裁切             | 想要沉浸感，能接受边缘被切       |
| `fill`    | 两轴各自拉满，允许变形                     | 背景图、纯色底板这类不怕变形的面 |
| `none`    | 不缩放，1 倍原样                           | 像素画、需要精确对齐的调试场景   |

`contain` 与 `cover` 是绝大多数情况下的选择：前者保证画面完整，后者保证没有黑边。同一份工程换个 `fit` 值就换一种取舍，不用改故事。

需要更细的控制时还能再给几个（都可省）：

- `scaleBy`：`min` / `max` / `width` / `height` / `fill`，或一个正数倍率（0.05–64）。给了就覆盖 `fit` 展开出来的缩放策略。
- `alignX` / `alignY`：`start` / `center` / `end`，留边时往哪边靠，缺省居中。
- `minScale` / `maxScale`：缩放上下限，各取 0.05–64。两条同时声明且 `minScale > maxScale` 时两条一起忽略。

写错的值逐项单独忽略回缺省，不会让整份清单失败。这几个值只影响显示：不进引擎状态、不进存档。

## 几种常见窗口

**手机竖屏**（比如 390×844）。舞台 1280×720 是横的，`contain` 会上下留大片黑边、画面缩得很小。这类工程建议把基准换成竖屏档（1080×1920 或 750×1334），按竖构图重排：

```json
{ "shell": { "stage": { "width": 1080, "height": 1920, "fit": "contain" } } }
```

**桌面 16:9 窗口**。基准与窗口同比例，`contain` 与 `cover` 结果一样，不留边也不裁切。

**超宽屏或带鱼屏**。`contain` 两侧留边，`cover` 上下裁切。想让留边落在某一侧（例如立绘靠右、留白靠左），配 `alignX`。

**大屏 / 4K**。缩放比大于 1 时位图素材会被放大，可能发虚。素材按高档基准准备（1920×1080 或 3840×2160），或直接换到对应档的基准，就能得到原生清晰度。

## 界面为什么不跟着舞台一起缩放

舞台整块被 `transform` 缩放，如果把工具栏、对话面板也放进这块，它们会被缩放放大一遍——窗口变大时界面按窗口尺寸本就变大了一次，再乘一个缩放比就成了二次变化，字会大得离谱。

所以宿主界面的正确做法是放在舞台**之外**的兄弟节点里，用窗口自己的单位排版：

```css
/* 舞台：整块缩放，作者坐标系 */
.stage-root {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

/* 界面：窗口坐标系，跟着窗口走 */
.shell-ui {
  position: fixed;
  inset: 0;
  padding: clamp(10px, 2.2vh, 22px) clamp(12px, 3vw, 40px);
  pointer-events: none;
}
```

两条经验：

- **舞台内的元素别用 `vw` / `vh` / `clamp()`**。它们按窗口算，算完又被舞台缩放一次，等于缩了两遍。舞台内一律用基准像素。
- **界面层反过来必须用窗口单位**。它的尺度和舞台缩放比无关，`clamp()` 与 `env(safe-area-inset-*)` 都是合适的选择（后者处理刘海与手势条）。

界面层容器通常要 `pointer-events: none`，需要交互的部件各自打开 `pointer-events: auto`——否则整块面板会静默吞掉点击。

## 图片和视频怎么填满自己的框

元素有 `width` / `height`，素材有自己的比例，两者不一致时由 `stretch` 决定：`fill` / `contain` / `cover` / `none` / `scale-down`，缺省 `cover`。背景元素固定铺满舞台，不需要写宽高。

细节见[视觉元素 · 媒体填充](/concepts/elements/)。

## 宿主怎么接这一层

引擎只算数，读窗口与写样式是宿主的事。三步：

```ts
import { resolveStageConfig } from "@lingfan-engine/core";
import { computeStageLayout, stageTransform } from "@lingfan-engine/shell";

// 1. 取配置：内建缺省 × 工程覆盖
const stage = resolveStageConfig(manifest);

// 2. 算布局：视口尺寸由你量
const layout = computeStageLayout(
  { width: viewport.clientWidth, height: viewport.clientHeight },
  stage,
);

// 3. 套用：写宽高与变换串
root.style.width = `${layout.width}px`;
root.style.height = `${layout.height}px`;
root.style.transformOrigin = "0 0"; // 先平移再缩放，原点必须取左上角
root.style.transform = stageTransform(layout);
```

窗口尺寸变化时重跑第 2、3 步。桌面与浏览器听 `resize` 与 `orientationchange`；小程序没有 `vw` / `vh` 概念，读系统信息算完交给页面样式。

计算里不读任何平台全局，所以桌面壳、浏览器宿主和小程序共用同一份口径——你换端时只需要换「怎么量视口」和「怎么落样式」这两件事。

脚手架自带的宿主已经接好这一层，直接改 `project.json` 就生效。你自己写的宿主可以照上面三步接；也可以直接用引擎提供的编排件，它会把「读数相同就不重复写样式」和「读不出尺寸时什么都不做」一并处理：

```ts
import { createStageFitter, createStagePort } from "@lingfan-engine/shell";

const fitter = createStageFitter({
  port: createStagePort({
    readRoot: () => stageRoot,
    readFrame: () => ({
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    }),
  }),
  config: stage,
});

fitter.refresh(); // 挂载后调一次
window.addEventListener("resize", () => fitter.refresh());
window.addEventListener("orientationchange", () => fitter.refresh());
```

编排件不注册监听——订阅时机与成对注销在各平台语义不同，归宿主自己管。

## 检查清单

- 故事里的坐标、字号、间距都按基准像素写，没有混进 `vw` / `vh`。
- `shell.stage` 的基准与目标画面的比例一致（横屏工程别用竖屏基准）。
- `fit` 的选择是有意的：要完整构图用 `contain`，要无黑边用 `cover`。
- 界面在舞台之外，用窗口单位排版，交互部件打开了 `pointer-events`。
- 图片与视频的 `stretch` 按内容决定，没有一律缺省。
- 在目标窗口的最小与最大尺寸上各看一次，确认没有意外的裁切或大片留边。

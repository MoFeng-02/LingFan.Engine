/**
 * 小程序宿主装配：从包内工程到可跑的叙事覆盖层，一次接线到位。
 *
 * 接线顺序与嵌入演示一致——装载工程 → 建引擎（注入平台端口与文案）→ 建表面 →
 * 建覆盖层 → 起帧循环。差别只有两处：表面把视图变成页面数据而不是 DOM 节点；
 * 舞台按视口与基准算出缩放再交给页面（小程序没有 vw/vh 之类整体缩放手段）。
 *
 * 本文件是组合根：允许它同时知道引擎、展示层与平台，别处不允许这样横跨。
 */
import { defaultEngineTexts, StoryEngine, type Story } from "@lingfan/engine";
import { loadProject } from "@lingfan/adapters";
import {
  computeStageLayout,
  DEFAULT_STAGE_FIT,
  DEFAULT_STAGE_HEIGHT,
  DEFAULT_STAGE_WIDTH,
  withSlotLabels,
  type StageConfig,
  type StageLayout,
} from "@lingfan/shell";
import {
  createElementResourceResolver,
  createNarrativeOverlay,
  type NarrativeOverlay,
} from "@lingfan/ui";
import { createFixtureProjectFilesPort } from "./fixture.ts";
import { createHostFrameSource } from "./frame.ts";
import { readWindowSize, type WechatCanvasNode } from "./platform.ts";
import { createWechatHostPorts, type WechatHostPorts } from "./ports.ts";
import {
  createWechatOverlaySurface,
  type WechatSurfacePatch,
} from "./surface.ts";
import { stageStyle } from "./view.ts";

/** 覆盖层字速（字符/秒） */
const TEXT_SPEED = 30;

/** 舞台基准与装入方式：1280×720 等比装入视口（换基准改这里即可） */
const STAGE_CONFIG: StageConfig = {
  width: DEFAULT_STAGE_WIDTH,
  height: DEFAULT_STAGE_HEIGHT,
  fit: DEFAULT_STAGE_FIT,
};

/** 页面数据补丁：覆盖层各层 + 舞台尺寸串 + 错误横幅 */
export type WechatHostPatch = WechatSurfacePatch & {
  stageBox?: string;
  error?: string;
};

/** 宿主装配参数 */
export interface WechatHostDeps {
  /** 页面数据发布口 */
  publish(patch: WechatHostPatch): void;
  /** 画布节点（有则用它做帧源；无则退回定时器帧源） */
  canvas?: WechatCanvasNode | null;
}

/** 宿主句柄：页面用它做重算、销毁与调试观测 */
export interface WechatHostHandle {
  engine: StoryEngine;
  overlay: NarrativeOverlay;
  ports: WechatHostPorts;
  /** 当前舞台布局（视口 + 基准算出的缩放与偏移） */
  layout(): StageLayout;
  /** 视口尺寸变化后重算布局并下发 */
  resize(): void;
  /** 卸载：停帧循环、退订状态、清空各层 */
  dispose(): void;
}

/** 启动小程序宿主：装载包内演示工程并起叙事循环 */
export async function startWechatHost(
  deps: WechatHostDeps,
): Promise<WechatHostHandle> {
  const story: Story = await loadProject(createFixtureProjectFilesPort());
  const ports = createWechatHostPorts();
  const engine = new StoryEngine(story, {
    savePort: ports.save,
    texts: withSlotLabels(defaultEngineTexts),
  });

  const surface = createWechatOverlaySurface({
    frame: createHostFrameSource(deps.canvas ?? null),
    publish: deps.publish,
  });

  // 元素资源解析是异步的而元素渲染是同步的：用现成的同步查表皮接上，
  // 解析完成后要求覆盖层补一次重渲（回调延后读 overlay，故用闭包而非参数）。
  const elementResources = createElementResourceResolver({
    resolve: (path) => ports.resources.resolve(path),
    onResolved: () => overlay.sync(),
  });
  const overlay: NarrativeOverlay = createNarrativeOverlay({
    surface,
    engine,
    textSpeed: TEXT_SPEED,
    resolveResource: elementResources.resolveForElement,
    onError: (message) => deps.publish({ error: message }),
  });

  let layout = computeStageLayout(readWindowSize(), STAGE_CONFIG);

  /** 读一次视口、重算布局并下发（初始化与尺寸变化共用） */
  function resize(): void {
    layout = computeStageLayout(readWindowSize(), STAGE_CONFIG);
    deps.publish({ stageBox: stageStyle(layout) });
  }

  resize();
  engine.start();

  return {
    engine,
    overlay,
    ports,
    layout: () => layout,
    resize,
    dispose: () => {
      overlay.dispose();
      engine.dispose();
    },
  };
}

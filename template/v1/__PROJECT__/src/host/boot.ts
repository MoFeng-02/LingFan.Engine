/**
 * 启动装配：端口 → 工程 → 引擎 → 视图 → 订阅 → 帧循环 → 开跑。
 *
 * 顺序是有约束的，不是随手排的：
 * 1. 端口先于引擎（引擎构造要吃存档端口）；
 * 2. 层级表先落一次 DOM（此时视频端口还没建，视频层不参与）；
 * 3. 视图先于订阅（订阅一建立就会回调，视图必须已经能接住）；
 * 4. `engine.start()` 最后（此前任何一次状态回调都还没有订阅者，也不该有）。
 *
 * 可配置项都走具名选项，缺省值即本宿主的现状取值：宿主换一个工程或换一套节律时
 * 只改组合根传进来的值，不动本文件。
 */

import {
  SYS,
  StoryEngine,
  resolveLayerZ,
  type AudioPort,
  type ResourcePort,
  type SavePort,
  type Story,
  type VideoPort,
} from "@lingfan/engine";
import {
  createFetchProjectFilesPort,
  createStaticResourcePort,
  createWebAudioPort,
  createWebStorageSavePort,
  createWebVideoPort,
  loadProject,
} from "@lingfan/adapters";
import {
  DEFAULT_TEXT_CPS,
  DEFAULT_TOAST_MS,
  createAudioRenderer,
  createVideoRenderer,
  type TypingSetting,
} from "@lingfan/ui";
import { createErrorReporter, type StageDom } from "./stage-dom";
import { createHostLayerZ } from "./layer-z";
import { fillSaveSlots, wireSaveSlots } from "./save-slots";
import { createToast } from "./toast";
import { createDialogueView } from "./dialogue-view";
import { createHostEffects } from "./effects";
import { wireEngine } from "./engine-wiring";
import { startHostFrameLoop } from "./frame-loop";
import { wireInput } from "./input-map";

/**
 * 装配输入：节点句柄表、资源根内的清单与故事表，以及两项可配置节律。
 * 取值全部由组合根给定——本文件不含宿主特有的字面量。
 */
export interface HostBootOptions {
  /** 常驻节点句柄表（由组合根解析 `#id` 得到） */
  dom: StageDom;
  /** 工程清单的逻辑路径（相对资源根） */
  manifestFile: string;
  /** 故事文件的逻辑路径表（相对资源根；新增故事必须同步此表） */
  stories: readonly string[];
  /** 故事未声明字速时的兜底（可见字符 / 秒）；缺省 = 展示层给出的默认字速 */
  defaultCps?: number;
  /** 提示条驻留毫秒数；缺省 = 展示层给出的默认时长 */
  toastDurationMs?: number;
}

/**
 * 装配并启动本宿主。失败时抛出（组合根负责把失败写进页面），
 * 中途失败不会留下半启动的宿主：所有接线都在本函数内完成，抛出即放弃。
 */
export async function bootHost(options: HostBootOptions): Promise<void> {
  const { dom } = options;

  // —— 工程文件：清单与故事同走 ProjectFilesPort（组装归引擎纯函数，宿主不预解析）——
  const filesPort = createFetchProjectFilesPort({
    manifest: options.manifestFile,
    stories: options.stories,
  });
  const manifest: unknown = await filesPort.manifest();
  const story: Story = await loadProject(filesPort);

  // —— 适配器装配（Web 形态；原生实现换端口，契约不变）——
  const reportError = createErrorReporter(dom);
  const resourcePort: ResourcePort = createStaticResourcePort();
  const audioPort: AudioPort = createWebAudioPort({ onError: reportError });
  const savePort: SavePort = createWebStorageSavePort();

  // —— 层级（z 序）：内建默认 × 工程覆盖（project.json 的 shell.layers）——
  const layerZ = resolveLayerZ(manifest);
  // 视频端口的 z 在端口内部（与 DOM 层不同），故端口晚于首次落 DOM 建立，
  // 由 getter 交给层级视图按需下发。
  let videoPort: VideoPort | null = null;
  const layers = createHostLayerZ({ dom, layerZ, readVideoPort: () => videoPort });
  layers.apply();

  videoPort = createWebVideoPort({ onError: reportError, zIndex: layerZ.video });

  // —— 存档壳配置：槽位（project.json 的 shell.saves.slots 可覆盖）——
  fillSaveSlots(dom, manifest);

  const engine = new StoryEngine(story, { historyLimit: 200, savePort });
  const audio = createAudioRenderer(engine, audioPort, resourcePort, {
    onError: reportError,
  });
  const video = createVideoRenderer(engine, videoPort, resourcePort, {
    onError: reportError,
    onVideoFinished: () => engine.videoFinished(), // 播放结束 → 引擎解除 video 等待
  });

  const toast = createToast({
    dom,
    durationMs: options.toastDurationMs ?? DEFAULT_TOAST_MS,
  });
  const dialogue = createDialogueView({
    dom,
    engine,
    defaultCps: options.defaultCps ?? DEFAULT_TEXT_CPS,
  });

  wireEngine({
    dom,
    engine,
    layers,
    dialogue,
    resources: resourcePort,
    toast,
    reportError,
    // 故事级打字机设置（`text_typewriter` 命令）；未设置时按默认字速走
    readTypingSetting: () => engine.get(SYS.typewriter) as TypingSetting | undefined,
    // 读档后媒体位置需显式对齐：引擎只回状态，播放位置由渲染器自己同步
    syncMedia: () => {
      audio.sync();
      video.sync();
    },
  });

  const driveEffects = createHostEffects({ dom, engine });
  startHostFrameLoop({
    dialogue,
    onMediaTick: () => audio.pollPosition(), // 媒体位置帧级回写
    onFrame: driveEffects,
  });
  wireInput({ dom, engine, dialogue });
  wireSaveSlots(dom, engine);

  engine.start();
}

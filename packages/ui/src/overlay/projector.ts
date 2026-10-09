/**
 * 渲染状态投影：把引擎的状态读成一份界面直接可用的渲染态。
 *
 * **为什么要有这一层**：界面不持有叙事真相，所有渲染态都是引擎状态经读口投影出来的。
 * 投影分两条入口——引擎的 `ValueChanged` 事件（增量，一次一个键）与 `sync()`
 * （全量，读档/回溯后整体对齐）——两条入口读的是同一批字段，因此取值口径集中在这里，
 * 不各写一份。
 *
 * 每份投影状态都归实例所有（本模块只导出工厂，不持有任何跨实例的共享变量）：
 * 两个覆盖层实例各有自己的说话人、等待态与打字机，互不串扰。
 */
import { instanceZLayer, SYS } from "@lingfan/engine";
import type { ElementInstance, StateReader, StoryEngine } from "@lingfan/engine";
import { renderDialogueLine } from "../dialogue/textView";
import { Typewriter } from "../dialogue/typewriter";
import { setLayerOverride } from "./layer-z";
import type { LayerZController } from "./layer-z";
import type { NarrativeOverlayView } from "./types";

/** 需要重渲的渲染目标（顺序即重渲顺序） */
export type RenderTarget = "dialogue" | "choices" | "elements";

/** 一次状态变更的处理结果：层级键走层级重写，其余键走渲染目标列表 */
export type ChangeEffect =
  | { kind: "layers" }
  | { kind: "render"; targets: readonly RenderTarget[] };

/**
 * 渲染态：全部字段都只由状态投影写入，
 * 除打字进度（`shownText` / `typewriter`）外一律直接来自读口。
 */
export interface RenderState {
  speaker: string;
  speakerColor: string;
  text: string;
  canAdvance: boolean;
  waiting: string;
  menuPrompt: string;
  menuOptions: Array<{ text: string; target: string }>;
  inputPrompt: string;
  nvlMode: string;
  nvlBuffer: string[];
  elementList: ElementInstance[];
  dialogHidden: boolean;
  typewriter: Typewriter | null;
  /** 打字机当前可见前缀（与 `text` 一并决定正文 HTML） */
  shownText: string;
  /** 实例级层级 z（每实例一份） */
  layerZ: LayerZController;
}

/**
 * 投影器：持有**一个实例**的渲染态，并把状态变更翻译成「该重渲什么」。
 *
 * 两条入口（增量 `applyChange` / 全量 `sync`）读同一批字段，因此不会出现
 * 「读档后与逐条变更后长得不一样」。渲染目标集也是这里算出来的——视图层只负责
 * 按 `RenderTarget` 重画，不自判该不该画。
 */
export interface Projector {
  readonly state: RenderState;
  /** 应用一次增量状态变更；层级键返回 `layers`，其余返回需要重渲的目标 */
  applyChange(key: string, value: unknown): ChangeEffect;
  /** 全量对齐（读档 / 回溯完成后调用）；返回需要重渲的目标 */
  sync(): readonly RenderTarget[];
  /** 当前正文 HTML（打字中 = 可见前缀；打完 = 整句） */
  lineHtml(): string;
  /** 渲染投影（只读快照） */
  view(): NarrativeOverlayView;
  /** 重建打字机（新句子到达时） */
  resetTypewriter(): void;
  /** 推进打字机一帧；返回可见前缀是否变化（变了才需要重渲） */
  tickTypewriter(dt: number): boolean;
  /** 瞬间打完当前句；返回是否确实有未完成的打字（false = 直接转推进） */
  finishTypewriter(): boolean;
}

/**
 * 造一个投影器：状态从空投影起步，需调 `sync()` 做首次全量对齐。
 *
 * 打字机随句子重建，`textSpeed` 在每次重建时读取（改它不影响正在打的这句）。
 * 层级 z 控制器由调用方注入——同一份控制器可被多个投影器共享（层级属覆盖层而非投影）。
 */
export function createProjector(deps: {
  reader: StateReader;
  engine: StoryEngine;
  layerZ: LayerZController;
  textSpeed: number;
}): Projector {
  const { reader, engine } = deps;

  const state: RenderState = {
    speaker: "",
    speakerColor: "",
    text: "",
    canAdvance: false,
    waiting: "none",
    menuPrompt: "",
    menuOptions: [],
    inputPrompt: "",
    nvlMode: "none",
    nvlBuffer: [],
    elementList: [],
    dialogHidden: false,
    typewriter: null,
    shownText: "",
    layerZ: deps.layerZ,
  };

  /**
   * 读菜单选项：文本与目标列成对。
   * 两个键分属不同 SSOT 条目，任一到达都重读**成对数据**（避免只更新一半）。
   */
  function readMenuOptions(): void {
    state.menuOptions = reader.menuChoices();
  }

  /** 说话人颜色派生（幂等）：命令覆盖色 > 角色定义色 > 空串 */
  function refreshSpeakerColor(): void {
    const override = reader.dialogColor();
    const def = engine.getCharacter(state.speaker);
    state.speakerColor = (override !== "" ? override : def?.color) ?? "";
  }

  /**
   * 重建打字机（新句子到达、或全量对齐时）。
   * 覆盖色与说话人色同源刷新：引擎写 `color` 与 `speaker` 是两个独立条目，
   * 派生值不依赖事件到达顺序，重算幂等。
   */
  function resetTypewriter(): void {
    state.typewriter = new Typewriter(state.text, deps.textSpeed);
    state.shownText = state.typewriter.visible;
  }

  function applyChange(key: string, value: unknown): ChangeEffect {
    const zLayer = instanceZLayer(key);
    if (zLayer !== undefined) {
      setLayerOverride(state.layerZ, zLayer, typeof value === "number" ? value : undefined);
      state.layerZ.apply();
      return { kind: "layers" };
    }

    if (key === SYS.currentDialogSpeaker) {
      state.speaker = reader.dialogSpeaker();
      refreshSpeakerColor();
      return { kind: "render", targets: ["dialogue"] };
    }
    if (key === SYS.currentDialogColor) {
      // 覆盖色与说话人色同源刷新（派生值不依赖事件到达顺序，重算幂等）
      refreshSpeakerColor();
      return { kind: "render", targets: ["dialogue"] };
    }
    if (key === SYS.currentDialogText) {
      state.text = reader.dialogText();
      resetTypewriter();
      return { kind: "render", targets: ["dialogue"] };
    }
    if (key === SYS.waiting) {
      const next = reader.waiting();
      state.waiting = next === "" ? "none" : next;
      state.canAdvance = state.waiting === "dialog";
      return { kind: "render", targets: ["dialogue", "choices"] };
    }
    if (key === SYS.dialogVisible) {
      state.dialogHidden = reader.dialogHidden();
      return { kind: "render", targets: ["dialogue"] };
    }
    if (key === SYS.menuPrompt) {
      state.menuPrompt = reader.menuPrompt();
      return { kind: "render", targets: ["choices"] };
    }
    if (key === SYS.menuOptions || key === SYS.menuTargets) {
      readMenuOptions();
      return { kind: "render", targets: ["choices"] };
    }
    if (key === SYS.inputPrompt) {
      state.inputPrompt = reader.inputPrompt();
      return { kind: "render", targets: ["choices"] };
    }
    if (key === SYS.nvlMode) {
      const next = reader.nvlMode();
      state.nvlMode = next === "" ? "none" : next;
      return { kind: "render", targets: [] };
    }
    if (key === SYS.nvlBuffer) {
      state.nvlBuffer = reader.nvlLines();
      return { kind: "render", targets: [] };
    }
    if (key === SYS.elements) {
      state.elementList = reader.elements();
      return { kind: "render", targets: ["elements"] };
    }
    // 与叙事渲染无关的键：仍通知宿主投影变化，但不触发任何层重渲
    return { kind: "render", targets: [] };
  }

  function sync(): readonly RenderTarget[] {
    state.speaker = reader.dialogSpeaker();
    refreshSpeakerColor();
    state.text = reader.dialogText();
    const waitState = reader.waiting();
    state.waiting = waitState === "" ? "none" : waitState;
    state.canAdvance = state.waiting === "dialog";
    state.menuPrompt = reader.menuPrompt();
    readMenuOptions();
    state.inputPrompt = reader.inputPrompt();
    const mode = reader.nvlMode();
    state.nvlMode = mode === "" ? "none" : mode;
    state.nvlBuffer = reader.nvlLines();
    state.dialogHidden = reader.dialogHidden();
    state.elementList = reader.elements();
    resetTypewriter();
    state.layerZ.overrides = reader.instanceZOverrides();
    state.layerZ.apply();
    return ["dialogue", "choices", "elements"];
  }

  function lineHtml(): string {
    return renderDialogueLine({
      text: state.text,
      typed:
        state.typewriter !== null && !state.typewriter.done
          ? state.shownText
          : undefined,
    }).html;
  }

  function view(): NarrativeOverlayView {
    return {
      speaker: state.speaker,
      text: state.text,
      lineHtml: lineHtml(),
      canAdvance: state.canAdvance,
      waiting: state.waiting,
      menuPrompt: state.menuPrompt,
      menuOptions: state.menuOptions,
      inputPrompt: state.inputPrompt,
      nvlMode: state.nvlMode,
      nvlLines: state.nvlBuffer,
      hasElements: state.elementList.length > 0,
    };
  }

  function tickTypewriter(dt: number): boolean {
    const tw = state.typewriter;
    if (tw === null || tw.done) return false;
    tw.tick(dt);
    const next = tw.visible;
    if (next === state.shownText) return false;
    state.shownText = next;
    return true;
  }

  function finishTypewriter(): boolean {
    const tw = state.typewriter;
    if (tw === null || tw.done) return false;
    tw.click();
    state.shownText = tw.visible;
    return true;
  }

  return {
    state,
    applyChange,
    sync,
    lineHtml,
    view,
    resetTypewriter,
    tickTypewriter,
    finishTypewriter,
  };
}

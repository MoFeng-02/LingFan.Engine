/**
 * 小程序覆盖层表面：把中立层的「每层显示什么」翻成页面数据。
 *
 * 中立核心只提交视图模型（对话/选择/通知）与两棵描述树（舞台/元素），落到节点这一端
 * 归宿主；小程序没有 DOM，所以这一端的产物是**数据补丁**——一次 setData 就是一次整层
 * 重建。通知的生命周期（到点移除）也在这里：中立面只给停留时长。
 *
 * 层级 z 与 DOM 侧的差别：WXML 没有 z-index 概念，层序由节点顺序决定。这里仍把 z 收下
 * 并下发，由页面按 z 排层（DOM 宿主用 z-index 落地，语义不变）。
 */
import type {
  ChoicesLayerView,
  DialogueLayerView,
  NotifyLayerItem,
  OverlayLayerId,
  OverlaySurface,
} from "@lingfan/ui";
import { toMiniTree, type MiniNode } from "./view.ts";
import type { WechatFrameSource } from "@lingfan/adapters";

/** 对话层的小程序形态（字段与 WXML 绑定一致） */
export interface MiniprogramDialogueData {
  visible: boolean;
  rootClass: string;
  speakerHtml: string;
  speakerColor: string;
  bodyHtml: string;
  bodyFont: string;
  hintHtml: string;
}

/** 选项的小程序形态：多一个稳定键供 wx:key 用 */
export interface MiniprogramChoiceOptionData {
  key: string;
  html: string;
  label: string;
  target: string;
}

/** 选择层的小程序形态（菜单与输入两形态互斥：`options` 与 `input` 只有一个非空） */
export interface MiniprogramChoicesData {
  rootClass: string;
  promptHtml: string;
  options: MiniprogramChoiceOptionData[];
  input: { prompt: string; submitText: string } | null;
}

/** 一条通知的小程序形态 */
export interface MiniprogramNoticeData {
  key: string;
  rootClass: string;
  bodyHtml: string;
}

/** 页面持有的覆盖层数据（首次渲染前各层为空） */
export interface MiniprogramSurfaceData {
  stage: MiniNode[];
  elements: MiniNode[];
  dialogue: MiniprogramDialogueData | null;
  choices: MiniprogramChoicesData | null;
  notices: MiniprogramNoticeData[];
  layers: Record<string, number>;
}

/** 一次整层提交：字段缺省即不动 */
export type MiniprogramSurfacePatch = Partial<MiniprogramSurfaceData>;

/** 表面装配参数 */
export interface MiniprogramSurfaceDeps {
  /** 帧源（覆盖层打字机与帧驱动表现都靠它） */
  frame: WechatFrameSource;
  /** 数据发布口：页面把补丁送进 setData */
  publish(patch: MiniprogramSurfacePatch): void;
}

/** 造小程序覆盖层表面 */
export function createMiniprogramOverlaySurface(
  deps: MiniprogramSurfaceDeps,
): OverlaySurface {
  /** 通知键的自增序号 */
  let noticeSeq = 0;
  /** 在排的通知移除定时器 */
  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** 当前在屏通知（顺序即呈现顺序） */
  let notices: MiniprogramNoticeData[] = [];
  /** 各层 z（由中立核心下发；页面按它排层） */
  const layers: Record<string, number> = {};
  let dialogue: MiniprogramDialogueData | null = null;
  let choices: MiniprogramChoicesData | null = null;

  function publishStage(tree: MiniNode[]): void {
    deps.publish({ stage: tree });
  }

  function publishElements(tree: MiniNode[]): void {
    deps.publish({ elements: tree });
  }

  return {
    frame: deps.frame,
    stage: {
      clear: () => publishStage([]),
      mount: (spec) => publishStage(toMiniTree(spec)),
    },
    elements: {
      clear: () => publishElements([]),
      mount: (spec) => publishElements(toMiniTree(spec)),
    },
    setLayerZ(layer: OverlayLayerId, z: number): void {
      layers[layer] = z;
      deps.publish({ layers: { ...layers } });
    },
    setDialogue(view: DialogueLayerView): void {
      dialogue = {
        visible: view.visible,
        rootClass: view.rootClass,
        speakerHtml: view.speakerHtml,
        speakerColor: view.speakerColor,
        bodyHtml: view.bodyHtml,
        bodyFont: view.bodyFont,
        hintHtml: view.hintHtml,
      };
      deps.publish({ dialogue });
    },
    setChoices(view: ChoicesLayerView | null): void {
      choices = view === null ? null : toChoicesData(view);
      deps.publish({ choices });
    },
    pushNotification(item: NotifyLayerItem, durationMs: number): void {
      const key = `notice-${noticeSeq}`;
      noticeSeq += 1;
      notices = [
        ...notices,
        { key, rootClass: item.rootClass, bodyHtml: item.bodyHtml },
      ];
      deps.publish({ notices });
      const timer = setTimeout(() => {
        timers.delete(timer);
        notices = notices.filter((notice) => notice.key !== key);
        deps.publish({ notices });
      }, durationMs);
      timers.add(timer);
    },
    clear(): void {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      notices = [];
      dialogue = null;
      choices = null;
      deps.publish({
        stage: [],
        elements: [],
        dialogue: null,
        choices: null,
        notices: [],
      });
    },
  };
}

/** 选择层视图 → 页面数据（选项补稳定键） */
function toChoicesData(view: ChoicesLayerView): MiniprogramChoicesData {
  return {
    rootClass: view.rootClass,
    promptHtml: view.promptHtml,
    options: view.options.map((option, index) => ({
      key: `option-${index}`,
      html: option.html,
      label: option.label,
      target: option.target,
    })),
    input: view.input === null ? null : { ...view.input },
  };
}

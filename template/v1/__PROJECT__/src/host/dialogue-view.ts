/**
 * 对话与等待态渲染：说话人 / 正文 / NVL / 菜单 / 输入 / 等待六个等待态落到 DOM 上。
 *
 * 「每个等待态都必须有可推进出口」是本模块的硬要求——引擎能进入的等待态一个都不能少，
 * 少了就是故事永久停滞。菜单与输入在渲染的同时挂好推进回调（`choose` / `input`），
 * 等待态与视频态给可跳过的可见提示，小游戏态给 fail-closed 提示（本模板不带注册表，
 * 不伪造完成）。
 *
 * 打字机实例与「当前已上屏的文本」都由本模块持有：帧循环每帧把可见文本交上来，
 * 是否重写 DOM 由这里判定——文本没变就不碰 DOM，否则每帧一次 innerHTML 会把
 * 行内标记重建成新节点。
 *
 * 显隐判定不在这里自算：NVL 是否接管、对话层是否让位都是展示层的纯函数
 * （`isNvlActive` / `isDialogueSuppressed`），本模块只把结果写成样式。
 */

import { SYS } from "@lingfan/engine";
import {
  DEFAULT_TEXT_CPS,
  Typewriter,
  isDialogueSuppressed,
  isNvlActive,
  isTypingEnabled,
  renderInlineMarkup,
  resolveTypingCps,
  type TypingSetting,
} from "@lingfan/ui";
import type { StageDom } from "./stage-dom";

/** 对话视图要用到的引擎能力：读状态、推进菜单与输入 */
export interface DialogueEngine {
  /** 读一个状态键的当前值 */
  get(key: string): unknown;
  /** 选中一个菜单项（推进 menu 等待态） */
  choose(optionId: string): void;
  /** 提交输入（推进 input 等待态） */
  input(value: string): void;
}

/**
 * 对话视图的输入：节点句柄表、引擎能力面与字速兜底。
 * 故事自己声明了打字机速度时以故事为准，`defaultCps` 只在故事未声明时生效。
 */
export interface DialogueViewOptions {
  /** 常驻节点句柄表 */
  dom: StageDom;
  /** 引擎能力面 */
  engine: DialogueEngine;
  /** 故事未声明字速时的兜底（可见字符 / 秒）；缺省 = 展示层给出的默认字速 */
  defaultCps?: number;
}

/** 对话视图句柄：状态键的每条意图各有一个落点，另有两个帧循环用的钩子 */
export interface DialogueView {
  /** 等待态切换：提示符、对话层让位与选项区形态一起更新 */
  setWaiting(waiting: string): void;
  /** 对话框显隐（`window show|hide`） */
  setDialogVisible(hidden: boolean): void;
  /** NVL 模式切换 */
  setNvlMode(mode: string): void;
  /** NVL 缓冲行整体替换 */
  setNvlBuffer(lines: readonly string[]): void;
  /** 菜单选项或输入提示变了：选项区整体重建 */
  setMenuChanged(): void;
  /** 新的一句正文：按故事级打字机设置决定整句直出还是逐字上屏 */
  setDialogText(text: string, setting: TypingSetting | undefined): void;
  /** 小游戏接管：提示里带上 game 名，便于作者定位 */
  setMinigame(game: string): void;
  /** 读当前打字机（整句直出时为 null） */
  readTypewriter(): Typewriter | null;
  /** 上交本帧的可见文本（未变化时不重写 DOM） */
  onText(visible: string): void;
}

/**
 * 造一个对话视图。六个等待态与两个显隐开关的状态都收在闭包里，每实例一份——
 * 放在模块级会让同一页面的两个宿主互相串扰。
 */
export function createDialogueView(options: DialogueViewOptions): DialogueView {
  const { dom, engine } = options;
  const defaultCps = options.defaultCps ?? DEFAULT_TEXT_CPS;

  /** 当前打字机；整句直出时为 null */
  let typewriter: Typewriter | null = null;
  /** 已上屏的文本：帧循环据此判断要不要重写 */
  let shown = "";
  /** 故事显式隐藏对话框（`window hide`） */
  let dialogHidden = false;
  /** NVL 模式（`"none"` = 关闭） */
  let nvlMode = "none";
  /** NVL 缓冲行（整体替换） */
  let nvlLines: readonly string[] = [];
  /** 当前等待态（决定对话层让位与选项区形态） */
  let waiting = "none";
  /** 小游戏接管名（提示文案用） */
  let minigameId = "";

  /**
   * 对话层与 NVL 层的显隐。
   * 两个让位理由独立：NVL 接管、故事显式隐藏、以及视频等待期——视频要占满舞台，
   * 压不住底部对话框会很难看。NVL 内容每次重算，因为模式与缓冲行是分开到达的两条状态。
   */
  function applyDialogueVisibility(): void {
    const nvl = isNvlActive(nvlMode, nvlLines);
    const suppressed = isDialogueSuppressed({
      nvlActive: nvl,
      hidden: dialogHidden,
      waiting,
    });
    dom.dialogue.style.display = suppressed ? "none" : "";
    dom.nvl.style.display = nvl ? "block" : "none";
    if (nvl) {
      dom.nvl.innerHTML = nvlLines
        .map((line) => renderInlineMarkup(line))
        .join("<br>");
    }
  }

  /** 等待态 UI：**每个等待态都必须有可推进出口**（否则故事停滞） */
  function renderChoices(): void {
    dom.choices.replaceChildren();
    if (waiting === "menu") {
      const prompt = document.createElement("p");
      prompt.className = "prompt";
      prompt.textContent = String(engine.get(SYS.menuPrompt) ?? "");
      dom.choices.append(prompt);
      const texts = (engine.get(SYS.menuOptions) as string[] | undefined) ?? [];
      const targets = (engine.get(SYS.menuTargets) as string[] | undefined) ?? [];
      texts.forEach((label, i) => {
        const button = document.createElement("button");
        button.className = "choice";
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => engine.choose(targets[i] ?? ""));
        dom.choices.append(button);
      });
    } else if (waiting === "input") {
      const prompt = document.createElement("p");
      prompt.className = "prompt";
      prompt.textContent = String(engine.get(SYS.inputPrompt) ?? "");
      const row = document.createElement("form");
      row.className = "input-row";
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 20;
      const ok = document.createElement("button");
      ok.type = "submit";
      ok.textContent = "确定";
      row.append(input, ok);
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value === "") return;
        engine.input(value);
      });
      dom.choices.append(prompt, row);
      input.focus();
    } else if (waiting === "wait" || waiting === "video") {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent =
        waiting === "video"
          ? "视频播放中……（点击或空格跳过）"
          : "等待中……（点击或空格跳过）";
      dom.choices.append(note);
    } else if (waiting === "minigame") {
      const banner = document.createElement("p");
      banner.className = "banner";
      banner.textContent =
        `故事进入了小游戏等待${minigameId === "" ? "" : `：${minigameId}`}。` +
        "本模板不带小游戏注册表（fail-closed：不伪造完成）——要在宿主里支持，" +
        "请用 `createMinigameRegistry` 注册，并在 mount 事件后调用 engine.resolveMinigame(result)。";
      dom.choices.append(banner);
    }
  }

  return {
    setWaiting(next: string): void {
      waiting = next;
      dom.hint.textContent = waiting === "dialog" ? "▼" : "";
      applyDialogueVisibility();
      renderChoices();
    },
    setDialogVisible(hidden: boolean): void {
      dialogHidden = hidden;
      applyDialogueVisibility();
    },
    setNvlMode(mode: string): void {
      nvlMode = mode;
      applyDialogueVisibility();
    },
    setNvlBuffer(lines: readonly string[]): void {
      nvlLines = lines;
      applyDialogueVisibility();
    },
    setMenuChanged(): void {
      renderChoices();
    },
    setDialogText(text: string, setting: TypingSetting | undefined): void {
      // 故事级打字机设置（`text_typewriter` 命令）；enabled=false = 整句即时
      const cps = resolveTypingCps(setting, defaultCps);
      typewriter = isTypingEnabled(setting) ? new Typewriter(text, cps) : null;
      if (typewriter === null) {
        shown = text;
        dom.text.innerHTML = renderInlineMarkup(text);
      }
    },
    setMinigame(game: string): void {
      minigameId = game;
      renderChoices();
    },
    readTypewriter(): Typewriter | null {
      return typewriter;
    },
    onText(visible: string): void {
      if (visible === shown) return;
      shown = visible;
      dom.text.innerHTML = renderInlineMarkup(visible);
    },
  };
}

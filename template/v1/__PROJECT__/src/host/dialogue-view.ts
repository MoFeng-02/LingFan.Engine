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

import {
  SYS,
  resolveTextSpeed,
  type PlayerPreferences,
} from "@lingfan-engine/core";
import {
  DEFAULT_TEXT_CPS,
  Typewriter,
  builtinBubbleTemplate,
  createDialogueTemplateRegistry,
  isDialogueSuppressed,
  isNvlActive,
  isTypingEnabled,
  renderInlineMarkup,
  sanitizeFont,
  type DialogueTemplateRegistry,
  type TypingSetting,
} from "@lingfan-engine/ui";
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
  /**
   * 玩家偏好（可选）：给了字速就走「偏好 > 故事 > 兜底」三级链（归属由偏好的
   * `textSpeedSource` 声明），且滑杆改动即时作用于正在打字的那一句；不给则保持
   * 旧行为（故事声明优先，兜底次之）。偏好独立于存档，回溯/读档不改字速。
   */
  preferences?: PlayerPreferences;
  /**
   * 对话框模板注册表（可选）：模板名由核心层解析三级优先级（命令 template > 角色 screen >
   * 工程默认）写入 `__dialog_template`，本视图按名解析、未知名/null 回退默认（fail-soft）。
   * 缺省 = 内置一张只含 bubble 默认的注册表（行为与旧版视觉全同）。模板只换皮肤与挂点内容，
   * 不改交互语义（推进/选项/输入仍由等待态驱动）。
   */
  templates?: DialogueTemplateRegistry;
  /**
   * 宿主静态文案查表（可选）：缺省恒等 = 原文直出（不接 i18n 时行为与旧版全同）。
   * 只包**宿主自己的字面量**（确定 / 等待提示）；故事内容（菜单、输入提示、候选）
   * 由引擎派生给译文，这里不再二次查表。
   */
  translate?: (text: string) => string;
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
  /** 放手：退订偏好变化（未接偏好时无操作）；拆除后不再响应滑杆 */
  dispose(): void;
}

/**
 * 造一个对话视图。六个等待态与两个显隐开关的状态都收在闭包里，每实例一份——
 * 放在模块级会让同一页面的两个宿主互相串扰。
 */
export function createDialogueView(options: DialogueViewOptions): DialogueView {
  const { dom, engine } = options;
  const defaultCps = options.defaultCps ?? DEFAULT_TEXT_CPS;
  const preferences = options.preferences;
  const t = options.translate ?? ((text: string): string => text);

  /** 当前打字机；整句直出时为 null */
  let typewriter: Typewriter | null = null;
  /** 本句的故事级打字机设置（字速三级链的「故事」一级，滑杆改动时仍要参照它） */
  let lastSetting: TypingSetting | undefined = undefined;

  /**
   * 本句当前生效字速：偏好 > 故事 > 兜底（归属由偏好 `textSpeedSource` 声明）。
   * 未接偏好时 `player` 缺席，解析退回「故事 > 兜底」，与旧行为全同。
   */
  function currentCps(): number {
    return resolveTextSpeed({
      player: preferences?.textSpeed,
      source: preferences?.textSpeedSource,
      story: lastSetting?.speed,
      fallback: defaultCps,
    });
  }

  // 滑杆即时生效：偏好一变就把正在打字的那一句的字速改掉（不必等下一句）。
  // 整句直出（typewriter=null）时无字速可改，跳过。退订在 dispose 成对做。
  const offPrefs =
    preferences?.onChange(() => {
      if (typewriter !== null) typewriter.setSpeed(currentCps());
    }) ?? null;

  // 模板注册表：缺省内置一张只含 bubble 默认的表（不接模板时视觉与旧版全同）。
  const templates =
    options.templates ??
    ((): DialogueTemplateRegistry => {
      const registry = createDialogueTemplateRegistry();
      registry.register("bubble", builtinBubbleTemplate, { makeDefault: true });
      return registry;
    })();
  /** 上一次落地的模板皮肤类（换模板时先撤旧类再加新类，布局类不动） */
  let lastRootClass = "";

  /**
   * 按当前模板把这一句落到骨架三挂点（说话人 / 正文 / 推进指示）+ 根皮肤类。
   * 模板名读核心层解析好的 `__dialog_template`（三级优先级已在核心算完），按名解析、
   * 未知名/null 回退默认（fail-soft，与注册表 fail-closed 刻意不同）。说话人色沿用宿主
   * 已落在 speaker 元素上的 style（角色色由引擎意图管线应用），模板只产 HTML 不改色。
   */
  function applyTemplate(visible: string): void {
    const rawName = engine.get(SYS.dialogTemplate);
    const fn =
      templates.resolve(typeof rawName === "string" ? rawName : null) ??
      builtinBubbleTemplate;
    const rawSpeaker = engine.get(SYS.currentDialogSpeaker);
    const speaker = typeof rawSpeaker === "string" ? rawSpeaker : "";
    const view = fn({
      speaker,
      speakerColor: dom.speaker.style.color ?? "",
      lineHtml: renderInlineMarkup(visible),
      canAdvance: waiting === "dialog",
    });
    if (view.rootClass !== lastRootClass) {
      if (lastRootClass !== "") dom.dialogue.classList.remove(lastRootClass);
      if (view.rootClass !== "") dom.dialogue.classList.add(view.rootClass);
      lastRootClass = view.rootClass;
    }
    dom.speaker.innerHTML = view.speakerHtml;
    dom.text.innerHTML = view.bodyHtml;
    dom.hint.innerHTML = view.hintHtml;
  }

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

  /**
   * 本句字体落 DOM（随每句正文调用）：引擎分辨链结果（SYS.dialogFont）过字符集
   * 白名单后上正文元素；空或非法名回落 CSS 变量（--lf-story-font，项目默认字体档）。
   */
  function applySentenceFont(): void {
    const raw = engine.get(SYS.dialogFont);
    const font = typeof raw === "string" ? sanitizeFont(raw) : null;
    if (font !== null) dom.text.style.fontFamily = `'${font}'`;
    else dom.text.style.removeProperty("font-family");
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
      const targets =
        (engine.get(SYS.menuTargets) as string[] | undefined) ?? [];
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
      // 输入框的可访问名取提示语（读屏念出问题而不是「编辑框」）
      input.setAttribute("aria-label", prompt.textContent ?? t("输入"));
      const ok = document.createElement("button");
      ok.type = "submit";
      ok.textContent = t("确定");
      row.append(input, ok);
      row.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = input.value.trim();
        if (value === "") return;
        engine.input(value);
      });
      dom.choices.append(prompt, row);
      input.focus();
      // 候选快捷值：点一项直接把该项 value 当输入提交（输入框仍可用）
      const candidates =
        (engine.get(SYS.inputOptions) as
          Array<{ text?: unknown; value?: unknown }> | undefined) ?? [];
      const shortcuts = candidates.filter(
        (item) =>
          typeof item?.text === "string" && typeof item?.value === "string",
      ) as Array<{ text: string; value: string }>;
      if (shortcuts.length > 0) {
        const row2 = document.createElement("div");
        row2.className = "choice-row";
        for (const candidate of shortcuts) {
          const button = document.createElement("button");
          button.className = "choice";
          button.type = "button";
          button.textContent = candidate.text;
          button.addEventListener("click", () => engine.input(candidate.value));
          row2.append(button);
        }
        dom.choices.append(row2);
      }
    } else if (waiting === "wait" || waiting === "video") {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent =
        waiting === "video"
          ? t("视频播放中……（点击或空格跳过）")
          : t("等待中……（点击或空格跳过）");
      dom.choices.append(note);
    } else if (waiting === "minigame") {
      const banner = document.createElement("p");
      banner.className = "banner";
      banner.textContent =
        `故事进入了小游戏等待${minigameId === "" ? "" : `：${minigameId}`}。` +
        "完成舞台上的小游戏后故事自动继续（回溯 / 导航可离开）；" +
        "未注册的小游戏会 fail-closed 报错而不伪造完成。";
      dom.choices.append(banner);
    }
  }

  return {
    setWaiting(next: string): void {
      waiting = next;
      // 推进指示随等待态走模板（canAdvance）；正文/说话人一并刷新保持一致
      applyTemplate(shown);
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
      lastSetting = setting;
      const cps = currentCps();
      typewriter = isTypingEnabled(setting) ? new Typewriter(text, cps) : null;
      applySentenceFont();
      if (typewriter === null) {
        shown = text;
        applyTemplate(text);
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
      applyTemplate(visible);
    },
    dispose(): void {
      offPrefs?.();
    },
  };
}

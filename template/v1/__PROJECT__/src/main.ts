/**
 * 组合根（唯一全知位置：装配适配器 → 加载组装工程 → 建引擎 → 挂载展示层）。
 *
 * 本宿主**不依赖任何 UI 框架**——这是「引擎框架无关」的活证明：渲染直接操作 DOM，
 * 换成 Vue / React / 其他只改本文件与 index.html，引擎与适配器零改动。
 * 形态：**纯 Web**（vite 静态根 `Resources/`）——Tauri 壳的装配（invoke / 资源加密 /
 * 方向锁定 / 宿主信息 / 热重载）见引擎仓库 `apps/playground` 的组合根。
 *
 * 接线顺序（规约 00 §3.3 分工铁律 / 08-U1 只写状态 + 订阅渲染）：
 *   1. 装配适配器：工程文件（fetch）+ ResourcePort + AudioPort + VideoPort + SavePort
 *   2. 加载并组装工程（清单 + 故事文本 → 纯函数 `assembleProject`）
 *   3. 建引擎：new StoryEngine（注入 savePort）
 *   4. 挂载：订阅 onStateChanged 渲染 + rAF 帧循环（打字机 / 媒体位置 / 帧驱动表现）
 *
 * 覆盖范围（本宿主**保证不卡死**：引擎能进入的每个等待态都有 UI 可推进）：
 *   dialogue / menu / input / wait / video / minigame（可见 fail-closed 提示）+
 *   舞台元素层（08 §二.1）+ 层级表（shell.layers）+ 存档（shell.saves.slots）。
 * 有意未做（属「少功能」而非「卡死」，见 README 边界表）：历史面板与回溯 UI、
 * 玩家偏好面板、I18N 供给、对话框模板注册、存档缩略图合成。
 */
import {
  SYS,
  StoryEngine,
  instanceZLayer,
  resolveInstanceZ,
  resolveLayerZ,
  resolveSavesConfig,
  slotIds,
  type AudioPort,
  type ElementInstance,
  type LayerId,
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
  Typewriter,
  createAudioRenderer,
  createCommandRegistry,
  createElementRegistry,
  createElementResourceResolver,
  createVideoRenderer,
  interpolateAnimation,
  registerBuiltinElementRenderers,
  renderElementTree,
  renderInlineMarkup,
  resolveElementAction,
  shakeOffset,
  transitionOpacity,
} from "@lingfan/ui";

/**
 * 工程清单与故事文件：**都在应用资源根 `Resources/` 内**（08-U7）。
 * 宿主把 `Resources` 作为静态根，故逻辑路径就是 `project.json` / `Stories/**`。
 * 清单放在资源根内是有意为之——只有资源根内的文件才会进打包产物，dev 与 prod 同机制。
 * **新增故事文件必须同步此表**（Web 形态按显式清单取文件）。
 */
const MANIFEST = "project.json";
const STORIES = ["Stories/title/title_main.story"];

const DEFAULT_CPS = 30;

function must<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) throw new Error(`宿主缺少节点：${selector}`);
  return el;
}

const rootEl = must("#stage-root");
const stageEl = must("#stage");
const dialogueEl = must("#dialogue");
const speakerEl = must("#speaker");
const textEl = must("#text");
const hintEl = must("#hint");
const nvlEl = must("#nvl");
const choicesEl = must("#choices");
const notificationsEl = must("#notifications");
const toolbarEl = must("#toolbar");
const slotEl = must<HTMLSelectElement>("#slot");
const transitionEl = must("#transition");
const errorEl = must("#error");

function reportError(message: string): void {
  errorEl.textContent = message;
  console.error(`[host] ${message}`);
}

async function main(): Promise<void> {
  // 一次供给：清单与故事同走 ProjectFilesPort（组装归引擎纯函数，宿主不预解析）
  const filesPort = createFetchProjectFilesPort({
    manifest: MANIFEST,
    stories: STORIES,
  });
  const manifest: unknown = await filesPort.manifest();
  const story: Story = await loadProject(filesPort);

  // —— 适配器装配（Web 形态；原生实现换端口，契约不变）——
  const resourcePort: ResourcePort = createStaticResourcePort();
  const audioPort: AudioPort = createWebAudioPort({ onError: reportError });
  const savePort: SavePort = createWebStorageSavePort();

  // —— ⑨-11 层级（z 序）：内建默认 × 工程覆盖（project.json shell.layers）——
  const layerZ = resolveLayerZ(manifest);
  // 08 §八.3 实例级 z（T01-03）：命令参数 `z` → 该层实例覆盖（缺省 = 回层默认）
  const zOverride: Partial<Record<string, number>> = {};
  function applyLayerZ(): void {
    const z = (layer: LayerId): number =>
      resolveInstanceZ(layer, zOverride[layer], layerZ);
    stageEl.style.zIndex = String(z("stage"));
    dialogueEl.style.zIndex = String(z("dialogue"));
    nvlEl.style.zIndex = String(z("dialogue"));
    choicesEl.style.zIndex = String(z("choices"));
    notificationsEl.style.zIndex = String(z("notifications"));
    toolbarEl.style.zIndex = String(z("toolbar"));
  }
  applyLayerZ();
  const videoPort: VideoPort = createWebVideoPort({
    onError: reportError,
    zIndex: layerZ.video,
  });
  // 08 §八.3 视频层实例 z：端口内部 z（与 DOM 层不同，需单独下发）
  const applyVideoZ = (): void => {
    videoPort.setZIndex?.(resolveInstanceZ("video", zOverride.video, layerZ));
  };

  // —— ⑨-12 存档壳配置：槽位数（project.json shell.saves.slots 可覆盖）——
  const saves = resolveSavesConfig(manifest);
  for (const id of slotIds(saves.slots)) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    slotEl.append(option);
  }

  const engine = new StoryEngine(story, { historyLimit: 200, savePort });
  const audio = createAudioRenderer(engine, audioPort, resourcePort, {
    onError: reportError,
  });
  const video = createVideoRenderer(engine, videoPort, resourcePort, {
    onError: reportError,
    onVideoFinished: () => engine.videoFinished(), // 播放结束 → 引擎解除 video 等待
  });

  /* ==================== 08 §二.1 舞台元素层 ==================== */
  const elementRegistry = createElementRegistry();
  registerBuiltinElementRenderers(elementRegistry);
  // 元素 `cmd` 的业务命令注册表：未注册 fail-closed（不静默吞掉）
  const commands = createCommandRegistry();
  // 资源解析缓存 = @lingfan/ui 共用实现（宿主只提供端口与重渲染回调）
  const elementResources = createElementResourceResolver({
    resolve: (path) => resourcePort.resolve(path),
    onResolved: renderElements,
  });

  /** F6 意图 → 命令：`nav` → 核心 navigate；`cmd` → 宿主命令注册表（`value` 点击时插值） */
  function activateElement(element: ElementInstance): void {
    const action = resolveElementAction(element.props);
    if (action.kind === "nav") {
      engine.navigate(action.target);
      return;
    }
    if (action.kind !== "cmd") return;
    const handler = commands.get(action.name);
    if (handler === undefined) {
      reportError(`元素命令未注册：${action.name}（宿主需经命令注册表提供）`);
      return;
    }
    handler(
      action.value === undefined ? undefined : engine.interpolate(action.value),
      element,
    );
  }

  let elements: readonly ElementInstance[] = [];
  function renderElements(): void {
    renderElementTree({
      registry: elementRegistry,
      container: stageEl,
      elements,
      activate: activateElement,
      resolveResource: elementResources.resolveForElement,
      onUnknownType: (type) => reportError(`元素类型未注册：${type}`),
    });
  }

  /* ==================== 渲染状态 ==================== */
  let typewriter: Typewriter | null = null;
  let shown = "";
  let dialogHidden = false;
  let nvlMode = "none";
  let nvlLines: string[] = [];
  let waiting = "none";
  let minigameId = "";

  function applyDialogueVisibility(): void {
    // 08 §二.6 window auto|show|hide：hide 即隐藏对话框（叙事语义归核心，DOM 归 UI）
    // 08 §一：video 等待期对话层让位（视频 z=100 < 对话 999，靠让位而非压层实现「video 不盖 say」）
    const nvl = nvlMode !== "none" && nvlLines.length > 0;
    dialogueEl.style.display =
      nvl || dialogHidden || waiting === "video" ? "none" : "";
    nvlEl.style.display = nvl ? "block" : "none";
    if (nvl) {
      nvlEl.innerHTML = nvlLines.map((line) => renderInlineMarkup(line)).join("<br>");
    }
  }

  /** 等待态 UI：**每个等待态都必须有可推进出口**（否则故事停滞） */
  function renderChoices(): void {
    choicesEl.replaceChildren();
    if (waiting === "menu") {
      const prompt = document.createElement("p");
      prompt.className = "prompt";
      prompt.textContent = String(engine.get(SYS.menuPrompt) ?? "");
      choicesEl.append(prompt);
      const texts = (engine.get(SYS.menuOptions) as string[] | undefined) ?? [];
      const targets = (engine.get(SYS.menuTargets) as string[] | undefined) ?? [];
      texts.forEach((label, i) => {
        const button = document.createElement("button");
        button.className = "choice";
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => engine.choose(targets[i] ?? ""));
        choicesEl.append(button);
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
      choicesEl.append(prompt, row);
      input.focus();
    } else if (waiting === "wait" || waiting === "video") {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent =
        waiting === "video" ? "视频播放中……（点击或空格跳过）" : "等待中……（点击或空格跳过）";
      choicesEl.append(note);
    } else if (waiting === "minigame") {
      const banner = document.createElement("p");
      banner.className = "banner";
      banner.textContent =
        `故事进入了小游戏等待${minigameId === "" ? "" : `：${minigameId}`}。` +
        "本模板不带小游戏注册表（D5 fail-closed：不伪造完成）——要在宿主里支持，" +
        "请用 `createMinigameRegistry` 注册，并在 mount 事件后调用 engine.resolveMinigame(result)。";
      choicesEl.append(banner);
    }
  }

  function addToast(text: string): void {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = text;
    notificationsEl.append(toast);
    window.setTimeout(() => toast.remove(), 2600);
  }

  engine.onStateChanged(({ key, value }) => {
    // 08 §八.3 实例级 z：命令参数进 SSOT → 重算该层（`undefined` = 回层默认）
    const zLayer = instanceZLayer(key);
    if (zLayer !== undefined) {
      if (typeof value === "number") zOverride[zLayer] = value;
      else delete zOverride[zLayer];
      applyLayerZ();
      if (zLayer === "video") applyVideoZ(); // 视频层在端口内部
      return;
    }
    if (key === SYS.currentDialogSpeaker) {
      speakerEl.textContent = typeof value === "string" ? value : "";
      const color = engine.getCharacter(speakerEl.textContent)?.color;
      speakerEl.style.color = typeof color === "string" ? color : "";
    } else if (key === SYS.currentDialogText) {
      const text = typeof value === "string" ? value : "";
      // 故事级打字机设置（text_typewriter op）；enabled=false = 整句即时
      const setting = engine.get(SYS.typewriter) as
        | { enabled?: boolean; speed?: number }
        | undefined;
      const speed =
        typeof setting?.speed === "number" && setting.speed > 0
          ? setting.speed
          : DEFAULT_CPS;
      typewriter =
        setting?.enabled === false ? null : new Typewriter(text, speed);
      if (typewriter === null) {
        shown = text;
        textEl.innerHTML = renderInlineMarkup(text);
      }
    } else if (key === SYS.waiting) {
      waiting = typeof value === "string" ? value : "none";
      hintEl.textContent = waiting === "dialog" ? "▼" : "";
      applyDialogueVisibility();
      renderChoices();
    } else if (key === SYS.nvlMode) {
      nvlMode = typeof value === "string" ? value : "none";
      applyDialogueVisibility();
    } else if (key === SYS.nvlBuffer) {
      nvlLines = Array.isArray(value) ? (value as string[]) : [];
      applyDialogueVisibility();
    } else if (key === SYS.menuOptions || key === SYS.menuTargets) {
      renderChoices(); // 两键分别派发：以最后写入的键为准做完整重建
    } else if (key === SYS.dialogVisible) {
      dialogHidden = value === "hide";
      applyDialogueVisibility();
    } else if (key === SYS.elements) {
      elements = (value as ElementInstance[] | undefined) ?? [];
      renderElements();
    }
  });

  engine.onEvent(({ payload }) => {
    if (payload.kind === "engine.error") {
      errorEl.textContent = `[${payload.code}] ${payload.message}`;
      console.error(`[engine] ${payload.code}: ${payload.message}`);
    } else if (payload.kind === "notify") {
      addToast(payload.text);
    } else if (payload.kind === "minigame.mount") {
      // D5：宿主经注册表挂载；本模板不接注册表 → 可见 fail-closed（提示里带 game 名，便于作者定位）
      minigameId = payload.game;
      renderChoices();
    } else if (payload.kind === "save.done") {
      addToast(`已保存到 ${payload.slot}`);
    } else if (payload.kind === "load.done") {
      addToast(`已读取 ${payload.slot}`);
      audio.sync();
      video.sync();
    }
  });

  /* ==================== 08 §二.2 帧驱动表现 ==================== */
  const animationElapsed = new Map<number, number>(); // seq → 已播秒数
  let transitionElapsed = 0;
  let shakeClock = 0;

  /** 数值属性 → CSS（与 `elementStyle` 映射口径一致） */
  function applyAnimatedProperty(
    node: HTMLElement,
    property: string,
    value: number,
  ): void {
    if (property === "x") node.style.left = `${value}px`;
    else if (property === "y") node.style.top = `${value}px`;
    else if (property === "opacity") node.style.opacity = String(value);
    else if (property === "rotation") node.style.transform = `rotate(${value}deg)`;
    else if (property === "scale") node.style.transform = `scale(${value})`;
  }

  function driveVisualEffects(dt: number): void {
    // ① 元素动画：累计 elapsed → 插值写 DOM → 播毕交回引擎（终值写回元素 props）
    //    **必须交回**：否则动画队列只增不减（长会话泄漏），且元素永远到不了终值
    for (const spec of engine.animations()) {
      const elapsed = (animationElapsed.get(spec.seq) ?? 0) + dt;
      animationElapsed.set(spec.seq, elapsed);
      const { value, done } = interpolateAnimation(spec, elapsed);
      const node = stageEl.querySelector<HTMLElement>(
        `[data-lf-id="${spec.target}"]`,
      );
      if (node !== null) applyAnimatedProperty(node, spec.property, value);
      if (done) {
        animationElapsed.delete(spec.seq);
        engine.animationFinished(spec.seq);
      }
    }

    // ② 全屏转场：读启动键按进度改遮罩，播毕清除
    const transition = engine.get(SYS.transition) as
      | { duration: number }
      | undefined;
    if (transition != null) {
      transitionElapsed += dt;
      const progress =
        transition.duration > 0 ? transitionElapsed / transition.duration : 1;
      transitionEl.style.display = "block";
      transitionEl.style.opacity = String(transitionOpacity(progress));
      if (progress >= 1) {
        transitionElapsed = 0;
        transitionEl.style.display = "none";
        engine.transitionFinished();
      }
    }

    // ③ 屏幕震动：对舞台根施加衰减偏移，播毕归位
    const shake = engine.get(SYS.shake) as
      | { intensity: number; duration: number }
      | undefined;
    if (shake != null) {
      shakeClock += dt;
      const progress = shake.duration > 0 ? shakeClock / shake.duration : 1;
      const { x, y } = shakeOffset(shake.intensity, progress, shakeClock);
      rootEl.style.transform = `translate(${x}px, ${y}px)`;
      if (progress >= 1) {
        shakeClock = 0;
        rootEl.style.transform = "";
        engine.shakeFinished();
      }
    }
  }

  let last = 0;
  const frame = (now: number): void => {
    const dt = last > 0 ? (now - last) / 1000 : 0;
    last = now;
    typewriter?.tick(dt);
    const next = typewriter?.visible ?? "";
    if (next !== shown) {
      shown = next;
      textEl.innerHTML = renderInlineMarkup(next);
    }
    audio.pollPosition(); // 08 §三.2 媒体位置帧级回写
    driveVisualEffects(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  /* ==================== 08 §七 输入映射 ==================== */
  // 语义归核心层（advance 自行裁定 skipable / 非等待态 fail-closed），这里只做映射
  function advance(): void {
    if (typewriter !== null && !typewriter.done) {
      typewriter.click(); // 08-U3 二段式：打字未完 → 瞬间完成/越过停顿
      return;
    }
    engine.advance();
  }

  rootEl.addEventListener("click", advance);
  // 交互层内的点击不推进故事（元素可交互节点在渲染器内自行 stopPropagation）
  for (const el of [choicesEl, toolbarEl, notificationsEl]) {
    el.addEventListener("click", (event) => event.stopPropagation());
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter") {
      if (event.target instanceof HTMLInputElement) return; // 输入框内不吞键
      event.preventDefault();
      advance();
    }
  });

  must<HTMLButtonElement>("#save").addEventListener("click", () => {
    engine.save(slotEl.value);
  });
  must<HTMLButtonElement>("#load").addEventListener("click", () => {
    engine.load(slotEl.value);
  });

  engine.start();
}

void main().catch((error: unknown) => {
  textEl.textContent = `启动失败：${String(error)}`;
  errorEl.textContent = `启动失败：${String(error)}`;
  console.error(error);
});
/**
 * 会话命令面的实现：启动、推进、选择、导航、存读档、语言切换与热重载。
 * 与门面 `StoryEngine` 的同名方法一一对应，宿主可见的语义都收在这里。
 * 只写状态与出站事件，不碰渲染。
 *
 * 只在运行层内部使用，不进包出口。
 */
import {
  SYS,
  type AudioChannelState,
  type EventListener,
  type I18nOverlayFile,
  type SaveDataV1,
  type SaveOptions,
  type StateListener,
  type Story,
  type VideoCommand,
} from "../../contracts/index.ts";
import {
  emitDerivedSurfaces,
  planOverlayMerge,
  resetSuspected,
  updateSources,
} from "../i18n/index.ts";
import { validSlot } from "./helpers.ts";
import { pausedSession } from "./waiting.ts";
import type { OpContext } from "./context.ts";

/**
 * 启动故事：置启动标志、初始化三个恒有定义的系统键、把顶层 defines 无条件写进全局层，
 * 再导航到入口列并开始解释执行。
 * 重复启动 fail-closed（不重置任何状态），入口列缺失时由 `enterColumn` 负责上报。
 */
export function start(ctx: OpContext): void {
  if (ctx.started) {
    ctx.fail("already-started", "故事已启动，重复 start 无效");
    return;
  }
  ctx.started = true;
  // 历史容量非法降级的诊断（装配期备好串）：start 时如实发出，宿主据此修正工程配置
  if (ctx.historyLimitNotice !== null) {
    ctx.emitEvent({
      kind: "engine.error",
      code: "history-limit-invalid",
      message: ctx.historyLimitNotice,
    });
  }
  // NVL 模式从 start 起恒有定义（静默初始化——事件流只承载离散变化）
  ctx.state.set(SYS.nvlMode, "none");
  // 当前语言从 start 起恒有定义（空串 = 默认语言/原文直出）
  ctx.state.set(SYS.currentLanguage, "");
  // 翻译源从 start 起恒有定义（静默；新档恒有该键，老存档检测据此键缺失判定）
  ctx.state.set(SYS.i18nSources, {});
  resetSuspected(ctx);
  // 顶层 defines 无条件 Set（全局层 = SSOT Map）
  for (const [key, value] of Object.entries(ctx.story.defines ?? {})) {
    ctx.setGlobal(key, value);
  }
  if (!ctx.enterColumn(ctx.story.entry)) return;
  ctx.run();
}

/**
 * 推进对话：`__dialog_complete = true` 是对话推进的唯一入口。
 * 仅在对话等待中有效——`wait` 的可跳过等待（skipable）复用本命令解除，命令面因此保持最小。
 * 非对话等待期调用 fail-closed。
 */
export function advance(ctx: OpContext): void {
  if (!ctx.started) {
    ctx.fail("advance-invalid", "故事尚未启动");
    return;
  }
  if (pausedSession(ctx)) {
    ctx.fail("pause-active", "引擎处于暂停中，advance 被拒绝");
    return;
  }
  const waiting = ctx.get(SYS.waiting);
  if (waiting === "dialog") {
    ctx.setSystem(SYS.dialogComplete, true);
    // 离开等待后清 clickable/noskip，防状态泄漏到后续非 say 命令
    ctx.setSystem(SYS.dialogClickable, false);
    ctx.setSystem(SYS.dialogNoskip, false);
    ctx.setSystem(SYS.waiting, "none");
    // say 的检查点在等待解除后提交（快照已在上屏时捕获 = 玩家所见画面）
    if (ctx.pendingSay !== null && !ctx.rollbackActive) {
      ctx.commitCheckpoint(ctx.pendingSay);
    }
    ctx.pendingSay = null;
    ctx.liveCheckpointed = false; // live 已越过检查点（后续等待点在 run 中自行改写）
    // voice auto_stop：玩家推进过该句 → 该句语音自动停止（互斥单槽）
    const voice = ctx.get(SYS.audioVoice) as
      AudioChannelState | null | undefined;
    if (voice?.kind === "play" && voice.autoStop === true) {
      ctx.setSystem(SYS.audioVoice, { kind: "stop", fadeMs: 0 });
    }
    ctx.run();
    return;
  }
  if (waiting === "wait") {
    if (!ctx.waitSkipable) {
      ctx.fail(
        "advance-invalid",
        "当前 wait 不可跳过（仅 skipable 的 wait 可点击解除）",
      );
      return;
    }
    ctx.clearTimer();
    ctx.waitSkipable = false;
    ctx.setSystem(SYS.waiting, "none");
    ctx.liveCheckpointed = false; // live 已越过该检查点
    ctx.run();
    return;
  }
  if (waiting === "video") {
    // cutscene 可跳过（skipable）→ 停视频并解除等待；不可跳 fail-closed
    const video = ctx.get(SYS.video) as VideoCommand | null | undefined;
    if (!(video?.kind === "play" && video.skipable)) {
      ctx.fail(
        "advance-invalid",
        "当前过场不可跳过（cutscene skipable=false）",
      );
      return;
    }
    ctx.videoSeq += 1;
    ctx.setSystem(SYS.video, {
      kind: "stop",
      seq: ctx.videoSeq,
    } satisfies VideoCommand);
    ctx.setSystem(SYS.waiting, "none");
    ctx.liveCheckpointed = false; // live 已越过该检查点
    ctx.run();
    return;
  }
  ctx.fail(
    "advance-invalid",
    `advance 仅在对话等待中有效（当前 __waiting=${String(waiting)}）`,
  );
}

/**
 * 选择菜单项：解析 `__menu_targets` 得序号并写入 `__menu_selected`。
 * 序号查找与等待态门槛都 fail-closed；选项目标即 columnId，选中即跳转并继续执行。
 */
export function choose(ctx: OpContext, optionId: string): void {
  if (!ctx.started || ctx.get(SYS.waiting) !== "menu") {
    ctx.fail(
      "choose-invalid",
      `choose 仅在菜单等待中有效（当前 __waiting=${String(ctx.get(SYS.waiting))}）`,
    );
    return;
  }
  if (pausedSession(ctx)) {
    ctx.fail("pause-active", "引擎处于暂停中，choose 被拒绝");
    return;
  }
  const targets = ctx.get(SYS.menuTargets);
  if (!Array.isArray(targets)) {
    ctx.fail("menu-state-corrupt", "__menu_targets 缺失或非数组");
    return;
  }
  const idx = targets.indexOf(optionId);
  if (idx < 0) {
    ctx.fail(
      "choice-unknown-target",
      `未知选项目标：${optionId}（fail-closed）`,
    );
    return;
  }
  ctx.setSystem(SYS.menuSelected, idx);
  ctx.setSystem(SYS.waiting, "none");
  ctx.liveCheckpointed = false; // 选择改变画面：live 未入档（回退将落回菜单重选）
  // menu 选项目标 = columnId——选择即跳转（columnId 换、index 归零）
  if (!ctx.enterColumn(targets[idx] as string)) return;
  ctx.run();
}

/**
 * 切换叙事坐标：UI 导航按钮与热重载重入的接缝，columnId 校验 fail-closed。
 * 纯切换不建检查点——与 op `navigate` 的叙事节点检查点相区分，壳层导航不落 DSL 检查点。
 * 切换前先把已上屏未入档的内容落定，并打断等待与外部接管。
 */
export function navigate(ctx: OpContext, columnId: string): void {
  if (!ctx.started) {
    ctx.fail("navigate-invalid", "故事尚未启动");
    return;
  }
  ctx.flushPendingCheckpoint(); // 离开当前画面：已上屏未入档的 say 即所见
  ctx.clearTimer(); // 打断任意等待（wait 定时器废弃，等待画面由新列重建）
  ctx.abortExternalTakeovers(); // 导航打断外部接管（小游戏/玩法系统）：abort 挂载信号（等待期可回溯同语义）
  ctx.waitSkipable = false;
  ctx.liveCheckpointed = false;
  ctx.setSystem(SYS.waiting, "none");
  // 源先于表面键清除：出站派生读「当时」的源，残留旧源会把清屏值译回非空
  updateSources(ctx, { dialog: undefined, speaker: undefined });
  ctx.setSystem(SYS.currentDialogText, ""); // 清旧对话镜像（导航清屏）
  ctx.setSystem(SYS.currentDialogSpeaker, "");
  ctx.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
  ctx.setSystem(SYS.dialogComplete, false);
  if (!ctx.enterColumn(columnId)) return;
  ctx.run();
}

/**
 * 写档：载荷编排在这一层完成，加密与安全校验在宿主侧。
 * 非等待语义——把写档交给宿主后立即返回，完成与失败都经出站事件可观测（不吞错）。
 * 未启动、槽位名非法或未装配存档端口时 fail-closed 并返回 false。
 */
export function save(
  ctx: OpContext,
  slot: string,
  options?: SaveOptions,
): boolean {
  if (!ctx.started) {
    ctx.fail("save-invalid", "故事尚未启动");
    return false;
  }
  if (!validSlot(slot)) {
    ctx.fail("save-invalid-slot", `槽位名非法：${slot}（字母数字/_/-，1..64）`);
    return false;
  }
  if (ctx.savePort === undefined) {
    ctx.fail(
      "save-unavailable",
      "未装配 SavePort（组合根经 EngineOptions 注入）",
    );
    return false;
  }
  const data = ctx.exportSave();
  if (data === null) return false; // exportSave 已发 engine.error（不在等待点）
  const payload: SaveDataV1 = { ...data, ...options };
  void ctx.savePort
    .write(slot, JSON.stringify(payload), ctx.saveMode)
    .then(() => ctx.emitEvent({ kind: "save.done", slot })) // 完成信号：UI 据此提示
    .catch((e: unknown) => {
      ctx.fail("save-write-failed", ctx.texts.saveWriteFailed(slot, String(e)));
    });
  return true;
}

/**
 * 读档：取回原始载荷后交 `importSave` 校验并传送，成功即抵达档内等待点。
 * 异步完成——校验或读取失败一律 fail-closed，状态原样，只经出站事件上报。
 */
export function load(ctx: OpContext, slot: string): boolean {
  if (!ctx.started) {
    ctx.fail("load-invalid", "故事尚未启动");
    return false;
  }
  if (!validSlot(slot)) {
    ctx.fail("load-invalid-slot", `槽位名非法：${slot}`);
    return false;
  }
  if (ctx.savePort === undefined) {
    ctx.fail("load-unavailable", "未装配 SavePort");
    return false;
  }
  void ctx.savePort
    .read(slot)
    .then((raw) => {
      const data = JSON.parse(raw) as SaveDataV1;
      // 校验失败由 importSave 发 engine.error 并返回 false（此时不发完成信号）
      if (ctx.importSave(data)) ctx.emitEvent({ kind: "load.done", slot });
    })
    .catch((e: unknown) => {
      ctx.fail("load-failed", ctx.texts.loadReadFailed(slot, String(e)));
    });
  return true;
}

/** 每引擎一份语言请求序号（后写胜：只有最新请求允许换表与出站） */
const languageRequestSeq = new WeakMap<OpContext, number>();

/**
 * 切换当前语言（七步）：校验 lang → 供给 loadOverlayFiles → 写 SYS.currentLanguage
 * → 重译可见表面 → 重译元素（递归 children）→ 重译 NVL → 出站派生键。
 * 重译不写状态、不重放：状态存原文，出站经派生漏斗给新语言译文；换表与重译出站
 * 在同一同步块内（中间无 await），宿主不会看到「新表旧值」的中间态。
 * 空串表示默认语言（原文直出）；未装配端口时同样只记语言状态，供界面观察。
 * 供给失败 fail-closed：保持原语言与译文表不变，只出站错误。
 * 并发请求后写胜（递增序号守卫）：过期请求静默丢弃——不出错不出站（正常竞争非失败）。
 * 幂等：同语言且译文表已装配时重复设置不供给、不写、不出站（但仍使更早挂起请求失效）。
 * 可在启动前调用（标题画面选语言），状态的写入与译文装配都不依赖启动态。
 */
export async function setLanguage(ctx: OpContext, lang: string): Promise<void> {
  if (typeof lang !== "string") {
    ctx.fail(
      "i18n-lang-invalid",
      "setLanguage 参数必须为字符串（空串 = 默认语言/原文直出）",
    );
    return;
  }
  // 序号先递增：幂等早退也是一次「最新意图」，必须使更早的挂起供给失效
  // （否则 en→ja 挂起中再设 en 会被早退跳过，ja 落地后反胜，违反后写胜）
  const seq = (languageRequestSeq.get(ctx) ?? 0) + 1;
  languageRequestSeq.set(ctx, seq);
  // 幂等早退：语言相同且表状态一致 ⇒ 不重复供给、不重复出站
  const port = ctx.i18nPort;
  const wantsDefault = lang === "" || port === undefined;
  const assembled = wantsDefault ? ctx.overlay === null : ctx.overlay !== null;
  if (ctx.state.get(SYS.currentLanguage) === lang && assembled) return;
  if (wantsDefault) {
    // 默认语言或未装配端口：无译文表 = 原文直出（同步路径）；
    // 序号已递增，更早的挂起供给 resolving 时同样被丢弃
    ctx.overlay = null;
    ctx.setSystem(SYS.currentLanguage, lang);
    emitDerivedSurfaces(ctx);
    return;
  }
  let files: I18nOverlayFile[];
  try {
    files = await port.loadOverlayFiles(lang);
  } catch (e: unknown) {
    // 已有更新请求：本次失败不再代表当前意图，静默丢弃（fail-closed 只报最新请求）
    if (seq !== languageRequestSeq.get(ctx)) return;
    ctx.fail("i18n-overlay-failed", ctx.texts.i18nLoadFailed(lang, String(e)));
    return;
  }
  if (seq !== languageRequestSeq.get(ctx)) return; // 被更新请求丢弃：不出错不出站
  // 同一同步块（步骤 3–7）：换表 → 写语言键 → 可见表面/元素/NVL 重译出站。
  // 合并走 planOverlayMerge：与编辑器/CLI 共用同一合并规则声明点。
  ctx.overlay = planOverlayMerge(files).entries;
  ctx.setSystem(SYS.currentLanguage, lang);
  emitDerivedSurfaces(ctx);
}

/**
 * 释放挂起定时器并中断外部接管（界面卸载、测试收尾时调用）。
 * 监听器退订不在这里——它由各注册方法返回的注销函数负责。
 */
export function dispose(ctx: OpContext): void {
  ctx.clearTimer();
  ctx.abortExternalTakeovers(); // 挂载 signal abort → 宿主卸载外部接管
  ctx.waitSkipable = false;
  // 暂停标记随销毁一起退场：留下真值会让复用同一实例的宿主继续看到「暂停中」
  if (pausedSession(ctx)) ctx.setSystem(SYS.paused, false);
}

/**
 * 热重载：原子替换故事树并保留运行态。
 * 变量、函数与历史检查点都不动——回溯按新列内容重放，文案即改即所见；
 * 当前列重入（等待被打断，画面由重放重建）；当前列在新树中不存在则上报后回入口列。
 */
export function reloadStory(ctx: OpContext, story: Story): void {
  if (!ctx.started) {
    ctx.fail("reload-invalid", "故事尚未启动");
    return;
  }
  ctx.story = story;
  const current = ctx.get(SYS.currentSceneColumn);
  const currentId = typeof current === "string" ? current : "";
  let targetId = currentId;
  if (currentId === "" || ctx.columnById(currentId) === undefined) {
    if (currentId !== "") {
      ctx.fail(
        "reload-column-missing",
        `当前列 ${currentId} 在新故事中不存在，回退入口列 ${story.entry}`,
      );
    }
    targetId = story.entry;
  }
  ctx.flushPendingCheckpoint(); // 离开当前画面：所见即入档
  ctx.clearTimer();
  ctx.abortExternalTakeovers(); // 热重载打断外部接管：abort 挂载信号
  ctx.waitSkipable = false;
  ctx.liveCheckpointed = false;
  ctx.setSystem(SYS.waiting, "none");
  if (!ctx.enterColumn(targetId)) return; // 入口列也缺失 = 兜底 fail-closed（组装器已保证存在）
  ctx.run();
}

/**
 * 订阅状态变化：`ValueChanged` 是唯一观察接缝，所有状态写入都经 set 系方法镜像到这里。
 * 返回注销函数，界面卸载时调用即可退订。
 */
export function onStateChanged(
  ctx: OpContext,
  listener: StateListener,
): () => void {
  ctx.stateListeners.add(listener);
  return () => {
    ctx.stateListeners.delete(listener);
  };
}

/**
 * 订阅出站事件：事件信封用于 `engine.error`、`notify` 与存档进度等异步信号。
 * 返回注销函数，界面卸载时调用即可退订。
 */
export function onEvent(ctx: OpContext, listener: EventListener): () => void {
  ctx.eventListeners.add(listener);
  return () => {
    ctx.eventListeners.delete(listener);
  };
}

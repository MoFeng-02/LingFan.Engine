/**
 * 会话命令面的实现：启动、推进、选择、导航、存读档、语言切换与热重载。
 * 与门面 `StoryEngine` 的同名方法一一对应，宿主可见的语义都收在这里。
 * 只写状态与出站事件，不碰渲染。
 *
 * 只在运行层内部使用，不进包出口。
 */
import { SYS, type AudioChannelState, type EventListener, type I18nOverlayFile, type SaveDataV1, type SaveOptions, type StateListener, type Story, type VideoCommand } from "../../contracts";
import { mergeOverlayFiles } from "../i18n";
import { validSlot } from "./helpers";
import type { OpContext } from "./context";

export function start(ctx: OpContext): void {
    if (ctx.started) {
      ctx.fail("already-started", "故事已启动，重复 start 无效");
      return;
    }
    ctx.started = true;
    // NVL 模式从 start 起恒有定义（静默初始化——事件流只承载离散变化）
    ctx.state.set(SYS.nvlMode, "none");
    // 当前语言从 start 起恒有定义（空串 = 默认语言/原文直出）
    ctx.state.set(SYS.currentLanguage, "");
    // 顶层 defines 无条件 Set（全局层 = SSOT Map）
    for (const [key, value] of Object.entries(ctx.story.defines ?? {})) {
      ctx.setGlobal(key, value);
    }
    if (!ctx.enterColumn(ctx.story.entry)) return;
    ctx.run();
  }

export function advance(ctx: OpContext): void {
    if (!ctx.started) {
      ctx.fail("advance-invalid", "故事尚未启动");
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

export function choose(ctx: OpContext, optionId: string): void {
    if (!ctx.started || ctx.get(SYS.waiting) !== "menu") {
      ctx.fail(
        "choose-invalid",
        `choose 仅在菜单等待中有效（当前 __waiting=${String(ctx.get(SYS.waiting))}）`,
      );
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
    ctx.setSystem(SYS.currentDialogText, ""); // 清旧对话镜像（导航清屏）
    ctx.setSystem(SYS.currentDialogSpeaker, "");
    ctx.setSystem(SYS.currentDialogColor, ""); // 同清：避免上一句的颜色覆盖残留
    ctx.setSystem(SYS.dialogComplete, false);
    if (!ctx.enterColumn(columnId)) return;
    ctx.run();
  }

export function save(ctx: OpContext, slot: string, options?: SaveOptions): boolean {
    if (!ctx.started) {
      ctx.fail("save-invalid", "故事尚未启动");
      return false;
    }
    if (!validSlot(slot)) {
      ctx.fail(
        "save-invalid-slot",
        `槽位名非法：${slot}（字母数字/_/-，1..64）`,
      );
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
        ctx.fail("save-write-failed", `槽位 ${slot} 写档失败：${String(e)}`);
      });
    return true;
  }

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
        ctx.fail("load-failed", `槽位 ${slot} 读取或解析失败：${String(e)}`);
      });
    return true;
  }

export async function setLanguage(ctx: OpContext, lang: string): Promise<void> {
    if (typeof lang !== "string") {
      ctx.fail(
        "i18n-lang-invalid",
        "setLanguage 参数必须为字符串（空串 = 默认语言/原文直出）",
      );
      return;
    }
    if (lang === "" || ctx.i18nPort === undefined) {
      // 默认语言或未装配端口：无译文表 = 原文直出（缺省；语言状态照记供 UI 观察）
      ctx.overlay = null;
      ctx.setSystem(SYS.currentLanguage, lang);
      return;
    }
    let files: I18nOverlayFile[];
    try {
      files = await ctx.i18nPort.loadOverlayFiles(lang);
    } catch (e: unknown) {
      ctx.fail(
        "i18n-overlay-failed",
        `载入 ${lang} 译文 overlay 失败（保持原语言）：${String(e)}`,
      );
      return;
    }
    ctx.overlay = mergeOverlayFiles(files); // 整表重建 = 清缓存再载入
    ctx.setSystem(SYS.currentLanguage, lang);
  }

export function dispose(ctx: OpContext): void {
    ctx.clearTimer();
    ctx.abortExternalTakeovers(); // 挂载 signal abort → 宿主卸载外部接管
    ctx.waitSkipable = false;
  }

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

export function onStateChanged(ctx: OpContext, listener: StateListener): () => void {
    ctx.stateListeners.add(listener);
    return () => {
      ctx.stateListeners.delete(listener);
    };
  }

export function onEvent(ctx: OpContext, listener: EventListener): () => void {
    ctx.eventListeners.add(listener);
    return () => {
      ctx.eventListeners.delete(listener);
    };
  }

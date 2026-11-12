/**
 * 对局会话的宿主侧装配：进没进对局、暂停与否，以及 `SYS.mounts` 的订阅与投影。
 *
 * 三件事都只碰本地 UI 状态与操作通道——页面不直接点引擎命令，引擎状态也不认识
 * 「在哪个页面」。舞台在会话期间始终挂载（元素层与帧循环都抓着它的节点），
 * 暂停只由页面遮罩接管点击。
 */
import { computed, nextTick, ref, type ComputedRef, type Ref } from "vue";
import {
  slotIds,
  type HostControls,
  type SavePort,
  type SavesConfig,
} from "@lingfan-engine/core";
import {
  latestSave,
  selectMounts,
  type MountSelection,
  type MountSource,
} from "@lingfan-engine/ui";
import { loadSlotViews, type SlotView } from "@lingfan-engine/shell";

/** 装配入参：操作通道、挂载面、存档面与三个宿主动作 */
export interface AppSessionOptions {
  /** 生效的操作通道（组合根注入优先，没有则是宿主自造的那一份） */
  controls: HostControls;
  /** 挂载表读数：`SYS.mounts` 的当前值经它订阅 */
  mounts: MountSource;
  /** 生成物里的 UI 组件表（名字 → 组件） */
  mountsTable: Readonly<Record<string, unknown>>;
  /** 存档壳配置：槽位 id 由 `slotIds` 生成 */
  saves: SavesConfig;
  /** 存档端口：「继续」要挑最新的一档，就得读槽位摘要 */
  savePort: SavePort;
  /** 进对局：启动引擎并进入工程入口列；给了列 id 则直达该列 */
  enterGame: (columnId?: string) => void;
  /** 读档继续：按槽位恢复进度（须已进对局） */
  continueGame: (slot: string) => void;
  /** 舞台点击：转发给叙事层推进对话 */
  advance: () => void;
  /** 舞台刚挂上时才量得到尺寸，故进对局后要再算一次适配 */
  applyStageFit: () => void;
}

/** 会话能力：页面态、挂载投影，以及启动页与暂停菜单的七个动作 */
export interface AppSession {
  inGame: Ref<boolean>;
  paused: Ref<boolean>;
  resumeSlot: Ref<string>;
  quickSlot: ComputedRef<string>;
  mounted: ComputedRef<readonly MountSelection[]>;
  onStart: () => void;
  /** 直达某列：跳过启动页直接进该列（开发期按章节调试用） */
  onEnterColumn: (columnId: string) => void;
  onContinue: (slot: string) => void;
  togglePause: () => void;
  syncPaused: (paused: boolean) => void;
  onResume: () => void;
  onSave: (slot: string) => void;
  onLoad: (slot: string) => void;
  onHome: () => void;
  onStageClickInGame: () => void;
  refreshResumeSlot: () => Promise<void>;
  /** 启动页的存档自选：是否展开了槽位列表 */
  browsingSaves: Ref<boolean>;
  /** 启动页的存档自选：逐槽视图（空表 = 还没读过/没有槽） */
  resumeViews: Ref<readonly SlotView[]>;
  /** 展开或收起存档自选（槽位数据由 `refreshResumeSlot` 负责，这里只管显隐） */
  toggleSaves: () => void;
  /** 选一个槽继续：收起列表并走与「继续」同一条路径 */
  onPickSave: (slot: string) => void;
  dispose: () => void;
}

/** 装配对局会话：本地页面态 + 挂载订阅 + 页面动作（动作一律经操作通道转调引擎） */
export function createAppSession(options: AppSessionOptions): AppSession {
  /** 是否已进对局：false 时只渲染启动页，舞台不在 DOM 里 */
  const inGame = ref(false);
  /** 是否暂停：舞台保持挂载，由暂停菜单接管点击 */
  const paused = ref(false);
  /** 可继续的槽位 id：空串 = 还没有存档 */
  const resumeSlot = ref("");
  /** 启动页是否展开存档自选 */
  const browsingSaves = ref(false);
  /** 存档自选的逐槽视图：空表表示还没读过，或本工程没有槽位 */
  const resumeViews = ref<readonly SlotView[]>([]);

  /** 进对局：置页面态 → 启动引擎（入口列）→ 舞台挂上后再量一次适配 */
  function onStart(): void {
    inGame.value = true;
    paused.value = false;
    options.enterGame();
    void nextTick(() => options.applyStageFit());
  }

  /**
   * 直达某列：置页面态 → 启动引擎 → 导航到目标列 → 舞台挂上后再量一次适配。
   *
   * 走的是与「开始」同一条启动路径，只是多带一个目标列：不读档、不显示启动页。
   */
  function onEnterColumn(columnId: string): void {
    inGame.value = true;
    paused.value = false;
    options.enterGame(columnId);
    void nextTick(() => options.applyStageFit());
  }

  /** 读档继续：先起引擎（命令面要求已启动），再从槽位恢复；进度到位由 load.done 事件驱动 */
  function onContinue(slot: string): void {
    if (slot === "") return;
    inGame.value = true;
    paused.value = false;
    options.enterGame();
    options.continueGame(slot);
  }

  /** 暂停/恢复开关：引擎侧收声与挂起等待定时器，页面态只决定谁遮住舞台 */
  function togglePause(): void {
    if (!inGame.value) return;
    if (paused.value) {
      options.controls.resume();
      paused.value = false;
    } else {
      options.controls.pause();
      paused.value = true;
    }
  }

  /**
   * 引擎侧暂停态回写：挂载 UI 或工具栏直接调操作通道暂停时，遮罩要跟着出现。
   * 页面态不从「是哪个按钮按的」推断——引擎写下的 `SYS.paused` 才是唯一依据。
   */
  function syncPaused(value: boolean): void {
    if (!inGame.value) return;
    paused.value = value;
  }

  /** 暂停菜单的「继续」：与 Esc 同一条路径，避免两处状态各写各的 */
  function onResume(): void {
    if (!paused.value) return;
    options.controls.resume();
    paused.value = false;
  }

  /**
   * 舞台点击：对局中才转发给叙事层。
   * 暂停时舞台仍挂在 DOM 里（上面盖着暂停菜单），漏点到的点击不该推进对话——
   * 内核也会按「暂停中」拒绝，但那会多走一趟失败上报，这里先挡掉。
   */
  function onStageClickInGame(): void {
    if (!inGame.value || paused.value) return;
    options.advance();
  }

  /** 暂停菜单的「保存进度」：有活动槽位才写；写成功由 save.done 事件刷新可继续槽位 */
  function onSave(slot: string): void {
    if (slot === "") return;
    options.controls.save(slot);
  }

  /** 暂停菜单的「读取存档」：读档后仍停在暂停态，由玩家自己决定何时继续 */
  function onLoad(slot: string): void {
    if (slot === "") return;
    options.controls.load(slot);
  }

  /** 回到标题：仍暂停（引擎留着），舞台卸下、启动页回来；可再「继续」回到原处 */
  function onHome(): void {
    options.controls.pause();
    paused.value = false;
    inGame.value = false;
  }

  /**
   * 刷新「继续」与存档列表：两件事一起做，因为它们回答的是同一个问题——现在有哪些档。
   *
   * 拆成两次读是因为要的东西不同：可继续槽位只要摘要里最新的那一个（挑法只有一份，
   * 在 UI 域的 `latestSave` 里），而列表要每槽的标题、缩略图与时间。同一次刷新里一起
   * 填，才能保证「继续」可点与列表非空始终同真同假——分两次填会让其中一个落在后面。
   *
   * `loadSlotViews` 自己就把摘要读失败降级成「全是空槽」、单槽读失败只丢标题与缩略图，
   * 它保证不抛，所以这里不再包一层 catch。
   */
  async function refreshResumeSlot(): Promise<void> {
    const slots = slotIds(options.saves.slots);
    try {
      const summaries = await options.savePort.list();
      resumeSlot.value = latestSave(summaries, slots)?.slot ?? "";
    } catch {
      resumeSlot.value = "";
    }
    resumeViews.value = await loadSlotViews({
      savePort: options.savePort,
      slotIds: slots,
    });
  }

  /** 启动页的存档自选：只收起/展开。槽位数据由 `refreshResumeSlot` 在写档、读档与首帧刷新 */
  function toggleSaves(): void {
    browsingSaves.value = !browsingSaves.value;
  }

  /** 选一个槽继续：收起列表，之后与「继续」完全同一条路径（含起引擎的顺序） */
  function onPickSave(slot: string): void {
    browsingSaves.value = false;
    onContinue(slot);
  }

  /** 挂载表原始值：首帧取一次快照，之后由订阅推新（订阅不回放历史，首帧要主动喂） */
  const mountsRaw = ref<unknown>(options.mounts.snapshot());

  /** 挂载表订阅：引擎写下新表就推一次；卸载时退订 */
  const stopMounts = options.mounts.subscribe((raw) => {
    mountsRaw.value = raw;
  });

  /** 挂载表投影：原始值 → 组件 + props（名字查生成物里的表） */
  const mounted = computed(() =>
    selectMounts(mountsRaw.value, options.mountsTable),
  );

  /** 快捷槽位：暂停菜单的存/读只动第一个槽位，多槽选择由工具条的槽位面板承担 */
  const quickSlot = computed(() => slotIds(options.saves.slots)[0] ?? "");

  return {
    inGame,
    paused,
    resumeSlot,
    quickSlot,
    mounted,
    onStart,
    onEnterColumn,
    onContinue,
    togglePause,
    syncPaused,
    onResume,
    onSave,
    onLoad,
    onHome,
    onStageClickInGame,
    refreshResumeSlot,
    browsingSaves,
    resumeViews,
    toggleSaves,
    onPickSave,
    dispose: stopMounts,
  };
}

/**
 * 系统键契约：引擎自己的状态键单一来源（`__` 前缀），以及「哪些键归引擎所有」的判定集合。
 * 这些键写进状态后就随快照 / 存档 / 回溯自动随行，界面按同一份键名读取。
 */

/** 系统键（`__` 前缀：不进用户存档、不进变量命名空间；v1 起类型化单一来源） */
export const SYS = {
  currentDialogText: "__current_dialog_text",
  currentDialogSpeaker: "__current_dialog_speaker",
  /**
   * **本句说话人颜色的覆盖值**（`say color="#888888"`）。
   *
   * 与「行内标记 `{color=…}`」是**两件事**（容易混淆）：
   * - 行内标记：写在**文本内部**，标记某一段文字的颜色
   * - 本键：写在**命令参数**上，覆盖**整句/说话人**的颜色
   *
   * **空串 = 无覆盖**（用 `character` 定义的颜色）⇒ 缺省即空串，既有前端逻辑不变。
   * UI 侧读法：`当前值 || character.color`（覆盖优先）。
   */
  currentDialogColor: "__current_dialog_color",
  /** 对话框模板名（null = 全局默认） */
  dialogTemplate: "__dialog_template",
  currentSceneColumn: "__current_scene_column",
  dialogComplete: "__dialog_complete",
  dialogClickable: "__dialog_clickable",
  dialogNoskip: "__dialog_noskip",
  menuPrompt: "__menu_prompt",
  menuOptions: "__menu_options",
  menuTargets: "__menu_targets",
  menuSelected: "__menu_selected",
  inputPrompt: "__input_prompt",
  rollbackActive: "__rollback_active",
  /** I18N 当前语言（setLanguage 命令写入，空串 = 默认语言/原文直出） */
  currentLanguage: "__current_language",
  /** auto_save 开关（auto_save op 写入：检查点建立时消费） */
  autoSave: "__auto_save",
  nvlMode: "__nvl_mode",
  nvlBuffer: "__nvl_buffer",
  waiting: "__waiting",
  /**
   * 进入 menu/ui 场景前的**可回溯坐标**（`{columnId, index}`）+ 等待态。
   *
   * **用途：在菜单里按存档，存的是「菜单前的游戏进度」**。值形如
   * `{ coord: {columnId, index}, waiting: string }`，缺省 = 不在菜单中。
   *
   * **不进快照的可见状态**：它是**引擎内部记账**，读取档不依赖它
   * —— 档里存的坐标已经是菜单前那个。
   */
  menuReturn: "__menu_return",
  /**
   * 实例级 z：单控件实例显式指定的层级（story 命令上的 `z`）。
   * 进 SSOT → 随快照 / 存档 / 回溯自动随行（重放到同一条命令即重新写入同一值）。
   * 宿主用 `resolveInstanceZ(层, 该值, 表)` 解析（实例 > 层默认 > 内建）；键不存在 = 未指定 = 层默认。
   * 键 ↔ 层映射单一事实源 = `runtime/shell.ts` 的 `INSTANCE_Z_KEYS`。
   */
  dialogueZ: "__dialogue_z",
  choicesZ: "__choices_z",
  notificationsZ: "__notifications_z",
  minigameZ: "__minigame_z",
  /**
   * 外部玩法系统接管（`interaction` op）的实例 z。
   * 与 `minigameZ` 复用同一渲染层（两者都是「外部系统整屏接管」形态），
   * 但独立成键——并行/嵌套接管时各自的 z 互不覆盖。
   */
  interactionZ: "__interaction_z",
  /** 视频层（`video`/`cutscene`）：宿主解析后交给 `VideoPort.setZIndex` */
  videoZ: "__video_z",
  // 四音频通道：状态入 SSOT → 快照/存档自动随行
  audioBgm: "__audio_bgm",
  audioSe: "__audio_se",
  audioAmbient: "__audio_ambient",
  audioVoice: "__audio_voice",
  /** 帧级键：UI 每帧回写，不进事件流 */
  bgmPosition: "__bgm_position",
  // 视频命令流（单通道）：状态入 SSOT → 快照随行
  video: "__video",
  /** video_skipable op 的持久开关（后续 video/cutscene 的缺省 skipable） */
  videoSkipable: "__video_skipable",
  /** 小游戏挂载信息（game/config/seq；signal 走事件不进 SSOT——运行时对象不可快照） */
  minigame: "__minigame",
  /**
   * 外部玩法系统接管信息（`interaction` op：system/config/seq）。
   * 与 `minigame` 同构（signal 走事件不进 SSOT）；`systems` 为可选的多系统并行清单。
   */
  interaction: "__interaction",
  /**
   * 舞台元素（声明式空间层，ElementInstance[]）：进入 scene 列时整体装载，
   * 列切换清空（空间层属于列），随快照/存档/回溯自动随行（整体 state Map 快照）。
   */
  elements: "__elements",
  /**
   * `window auto|show|hide`：对话框显隐三态（UI 层据此控制对话层可见性；
   * 叙事语义归核心层，DOM 操作归 UI）。
   */
  dialogVisible: "__dialog_visible",
  // —— 表现类（帧驱动）：核心只写「启动/动画描述」，UI 每帧插值 ——
  /**
   * 元素动画队列（`animate` / `animate_block` 写入）：`AnimationSpec[]`。
   * UI 每帧插值应用到 DOM（不逐帧写 SSOT），完成后调 `animationFinished(seq)`
   * 由核心把终值写回元素 `props` 并移除条目（快照/回溯自然随行）。
   */
  animations: "__animations",
  /** 全屏转场（`transition`）：`{ type, duration, seq }`；UI 播放完毕调 `transitionFinished()` 清除 */
  transition: "__transition",
  /** 屏幕震动（`shake`）：`{ intensity, duration, seq }`；UI 驱动偏移，播毕调 `shakeFinished()` */
  shake: "__shake",
  /** 故事级打字机设置（`text_typewriter`）：`{ enabled?, speed? }`；玩家偏好可覆盖 */
  typewriter: "__typewriter",
} as const;

/**
 * 键命名空间：保留键 = `SYS` 全集。
 * 判定 = 精确键名（非 `__` 前缀一刀切——作者自用 `__xxx` 非保留键是现状且被测试使用）；
 * 程序化写入命中即 fail-closed（`reserved-key`）——`SYS` 键归引擎所有，外部写入会直接破坏
 * 等待状态机 / 回溯等引擎状态。作者在故事里 `set` 自己的变量只受本条约束（可继续自用 `__xxx`）。
 * 将来扩展程序化写入另须走 `ext.<extensionId>.<key>` 命名空间。
 */
export const RESERVED_STATE_KEYS: ReadonlySet<string> = new Set(
  Object.values(SYS),
);

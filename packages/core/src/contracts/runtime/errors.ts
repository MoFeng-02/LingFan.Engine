/**
 * 引擎错误码目录：全仓稳定错误码的单一事实源。
 *
 * 是什么：`engine.error` 事件与 Rust 命令边界错误所用错误码的集中 union。
 * 为什么：宿主诊断、i18n 文案与跨语言桥校验都要按码分流；散落的字符串字面量
 *   无法保证 TS 与 Rust 两侧同步，也无法让消费方做穷举收窄。本目录是唯一声明处，
 *   其余各层只消费、不得另立第二份错误码清单。
 * 怎么用：`EngineErrorCode` 供类型收窄；`isEngineErrorCode` 守卫在 shared 层
 *   （契约层零实现），把未知字符串收窄为已知码。
 *   `EngineErrorPayload.code` 仍保持 `string`——扩展宿主可回传自有错误码，不在本目录
 *   枚举之内，守卫只用于识别「引擎与 Rust 边界的已知码」，不拒绝目录外的合法扩展码。
 * 注意事项：本文件零依赖（不 import runtime/ui/adapters，避免契约层回边）；
 *   已发布码只增不改。动态族码（`<op>-<后缀>`）按实际注册的 op 集逐一展开列出，
 *   新增 op 或后缀时须同步补录，桥校验与覆盖测试据此互锁。
 */

/**
 * 已知错误码全集（引擎字面量码 + 表达式码 + 动态族展开码 + Rust 边界码 + 兜底码）。
 * 数组即单一事实源；`EngineErrorCode` 由它派生，禁止在别处重复声明同义清单。
 */
export const ENGINE_ERROR_CODES = [
  // —— 执行与流程控制（分发 / 帧栈 / 循环 / 函数 / 守卫 / 自定义 op）——
  "advance-invalid",
  "already-started",
  "assert-failed",
  "call-invalid-target",
  "call-unknown-target",
  "choice-unknown-target",
  "choose-invalid",
  "custom-op-threw",
  "custom-op-wait-undeclared",
  "eval-type-error",
  "func-duplicate",
  "guard-args-unsafe",
  "guard-failed",
  "guard-threw",
  "guard-unknown",
  "loop-limit",
  "navigate-invalid",
  "no-forward",
  "pause-active",
  "reserved-key",
  "return-outside-func",
  "unknown-column",
  "unknown-op",
  "value-not-serializable",

  // —— 对话 / 文本 / 角色 / 输入 / 多语言 ——
  "character-invalid-field",
  "character-invalid-key",
  "character-unknown-field",
  "i18n-lang-invalid",
  "i18n-overlay-failed",
  "input-invalid",
  "input-state-corrupt",
  "menu-state-corrupt",
  "nvl-invalid-mode",
  "nvl-unknown-field",
  "say-invalid",
  "say-invalid-color",
  "say-invalid-font",
  "say-invalid-template",
  "say-unknown-field",
  "text_typewriter-invalid",

  // —— 元素 / 视觉 / 挂载 ——
  "animate-invalid",
  "animate_block-invalid",
  "hide-invalid",
  "instance-z-invalid",
  "mount-invalid-name",
  "mount-invalid-props",
  "mount-invalid-visible",
  "mount-unknown-field",
  "mount-unsafe-props",
  "show-invalid",
  "style-invalid",
  "style-target-not-found",
  "style-unknown-attr",
  "transition-invalid",
  "window-invalid",
  "zindex-invalid",
  "zindex-target-not-found",

  // —— 音频 / 视频实例（字面量码；动态族见下）——
  "audio_play-instance-limit",
  "audio_play-invalid-channel",
  "audio_play-invalid-instance",
  "audio_play-invalid-resource",
  "audio_seek-channel-stopped",
  "audio_seek-instance-stopped",
  "audio_stop-invalid-instance",
  "audio_stop-unknown-instance",
  "audio_volume-channel-stopped",
  "audio_volume-instance-stopped",
  "audio_volume-missing-volume",
  "audio_volume-unknown-instance",
  "video-finish-invalid",
  "video_skipable-invalid-value",

  // —— 存档 / 读档 / 回退 / 历史 ——
  "auto_save-invalid",
  "auto_save-unknown-field",
  "body-invalid",
  "history-empty",
  "load-failed",
  "load-invalid",
  "load-invalid-slot",
  "load-unavailable",
  "load-unknown-field",
  "reload-column-missing",
  "reload-invalid",
  "rollback-in-progress",
  "rollback-invalid",
  "rollback-target-not-found",
  "rollback-target-out-of-range",
  "save-delete-failed",
  "save-format",
  "save-invalid",
  "save-invalid-slot",
  "save-migrate-failed",
  "save-story-mismatch",
  "save-story-version",
  "save-unavailable",
  "save-unknown-field",
  "save-write-failed",
  "save_delete-invalid",
  "save_delete-unknown-field",

  // —— 扩展 / 玩法 / 交互 / 小游戏 ——
  "element-ops-blocked-op",
  "element-ops-interrupted",
  "element-ops-invalid",
  "extension-missing",
  "extension-op-mismatch",
  "extension-resolve-invalid",
  "extension-restore",
  "extension-result-invalid",
  "extension-state-corrupt",
  "extension-version",
  "game-system-invalid",
  "interaction-invalid",
  "interaction-resolve-invalid",
  "interaction-result-invalid",
  "interaction-state-corrupt",
  "interaction-system-mismatch",
  "interaction-unknown-field",
  "minigame-invalid",
  "minigame-missing",
  "minigame-resolve-invalid",
  "minigame-result-invalid",
  "minigame-state-corrupt",
  "minigame-unknown-field",
  "minigame-version",

  // —— 表达式求值（ExpressionErrorCode 全集；经 ctx.fail(e.code) 原样透传）——
  "arity-error",
  "division-by-zero",
  "invalid-range",
  "non-chained-comparison",
  "parse-error",
  "type-error",
  "unknown-function",
  "unknown-variable",

  // —— 动态族：`<op>-outside-loop`（break / continue 不在循环体内）——
  "break-outside-loop",
  "continue-outside-loop",

  // —— 动态族：`<op>-unknown-field`（各 op 族未知负载字段，op 集按分发路由展开）——
  "wait-unknown-field",
  "pause-unknown-field",
  "bgm-unknown-field",
  "se-unknown-field",
  "ambient-unknown-field",
  "voice-unknown-field",
  "stop_bgm-unknown-field",
  "stop_ambient-unknown-field",
  "stop_voice-unknown-field",
  "stop_se-unknown-field",
  "audio_pause-unknown-field",
  "audio_resume-unknown-field",
  "audio_play-unknown-field",
  "audio_stop-unknown-field",
  "audio_volume-unknown-field",
  "audio_seek-unknown-field",
  "video-unknown-field",
  "cutscene-unknown-field",
  "seek_video-unknown-field",
  "pause_video-unknown-field",
  "resume_video-unknown-field",
  "stop_video-unknown-field",
  "video_skipable-unknown-field",
  "show-unknown-field",
  "hide-unknown-field",
  "background-unknown-field",
  "bg_switch-unknown-field",
  "zindex-unknown-field",
  "style-unknown-field",

  // —— 动态族：`<op>-target-not-found`（animate / animate_block 未命中元素）——
  "animate-target-not-found",
  "animate_block-target-not-found",

  // —— 动态族：`<op>-invalid`（background / bg_switch 资源为空）——
  "background-invalid",
  "bg_switch-invalid",

  // —— 动态族：`<op>-invalid-resource`（起播通道与视频族资源为空）——
  "bgm-invalid-resource",
  "se-invalid-resource",
  "ambient-invalid-resource",
  "voice-invalid-resource",
  "video-invalid-resource",
  "cutscene-invalid-resource",

  // —— 动态族：`<op>-invalid-channel`（暂停 / 恢复 / 音量 / 定位的通道非法）——
  "audio_pause-invalid-channel",
  "audio_resume-invalid-channel",
  "audio_volume-invalid-channel",
  "audio_seek-invalid-channel",

  // —— 动态族：`<op>-target-conflict`（inst 与 channel 互斥，恰好给一个）——
  "audio_pause-target-conflict",
  "audio_resume-target-conflict",
  "audio_volume-target-conflict",
  "audio_seek-target-conflict",

  // —— 动态族：`<op>-invalid-instance`（实例 id 形态非法）——
  "audio_pause-invalid-instance",
  "audio_resume-invalid-instance",
  "audio_seek-invalid-instance",
  "audio_volume-invalid-instance",

  // —— 动态族：`<op>-unknown-instance`（实例不存在）——
  "audio_pause-unknown-instance",
  "audio_resume-unknown-instance",
  "audio_seek-unknown-instance",

  // —— 动态族：`<op>-invalid-volume`（volume 非有限数字）——
  "bgm-invalid-volume",
  "se-invalid-volume",
  "ambient-invalid-volume",
  "voice-invalid-volume",
  "audio_play-invalid-volume",
  "audio_volume-invalid-volume",
  "video-invalid-volume",
  "cutscene-invalid-volume",

  // —— 动态族：`<op>-invalid-fade`（fade 非「非负有限数字」）——
  "bgm-invalid-fade",
  "se-invalid-fade",
  "ambient-invalid-fade",
  "voice-invalid-fade",
  "stop_bgm-invalid-fade",
  "stop_ambient-invalid-fade",
  "stop_voice-invalid-fade",
  "stop_se-invalid-fade",
  "audio_play-invalid-fade",
  "audio_stop-invalid-fade",

  // —— 动态族：`<op>-invalid-seconds`（定位秒数非「非负有限数字」）——
  "audio_seek-invalid-seconds",
  "seek_video-invalid-seconds",

  // —— 动态族：`<op>-missing-target`（音量 / 定位缺 inst 与 channel）——
  "audio_volume-missing-target",
  "audio_seek-missing-target",

  // —— Rust 命令边界错误码（各适配器枚举经 serde(tag="code") 序列化的 code 值）——
  // 存档：keyring / io / crypto / bad-format / unknown-slot / invalid-slot / rollback-detected
  // 资源解密：invalid-path / missing-key / app-data / too-large（io / crypto / bad-format 与存档共用）
  // 偏好：bad-json（io 共用）
  // 工程文件供给：resource-dir / mobile-asset / missing-manifest / bad-manifest /
  //   missing-stories / decrypt / watch / watch-dev-only（io 共用）
  // 工程写回：root / bad-path / bad-delete（io 共用）
  // 壳控制：bad-mode / native
  "app-data",
  "bad-delete",
  "bad-format",
  "bad-json",
  "bad-manifest",
  "bad-mode",
  "bad-path",
  "crypto",
  "decrypt",
  "invalid-path",
  "invalid-slot",
  "io",
  "keyring",
  "missing-key",
  "missing-manifest",
  "missing-stories",
  "mobile-asset",
  "native",
  "resource-dir",
  "rollback-detected",
  "root",
  "too-large",
  "unknown-slot",
  "watch",
  "watch-dev-only",

  // —— 兜底：Rust 命令失败但无法识别为上述已知码时的归类（不静默吞错）——
  "rust-command-failed",
] as const;

/** 已知引擎 / Rust 边界错误码的联合类型（由 ENGINE_ERROR_CODES 派生，只增不改）。 */
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

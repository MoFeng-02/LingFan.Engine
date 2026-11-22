/**
 * 偏好面板的扩展控件组：主音量 + 文本/显示偏好 + 播放节奏 + 字体 + 缓办禁用占位。
 *
 * 只渲染真正接了消费的字段（读写 `PlayerPreferences` 即时生效）；契约已增、
 * 尚未接线的字段（打字音效/窗口尺寸）画成禁用占位并附说明，
 * 不留「活控件死配置」。值域一律引用核心契约常量，不在这里抄第二份数字。
 *
 * 播放节奏四项（自动播放/自动延时/阅读速度/快进只走已读）由 `input-map` 的节奏循环实时读，
 * 开关变化即起停循环——它们不是占位，是活控件。实际停留 = 基础停留 + 该句词元量 /
 * 阅读速度，长句停得久、短句停得短。
 *
 * 字体档不是缓办字段：选项由调用方传入（宿主从 `virtual:story-fonts` 取，与
 * `theme-fonts` 注入 @font-face 的同一份构建期清单），选中值经
 * `applyDialogueAppearance` 落到对话框 CSS 变量，并由字体名注册表校验——所以它是活控件。
 * 清单走参数而不是在此直接 import 虚拟模块，面板才能在测试里以纯数据驱动。
 *
 * 与主面板共用 `preferences-dom` 的行构件；本组返回一个 `sync()`，由主面板在
 * 挂载与每次偏好变化时统一调用，控件值与读数都随偏好现读回填。
 */

import {
  AUTO_DELAY_MS_RANGE,
  AUTO_READ_CPS_RANGE,
  DIALOGUE_POSITIONS,
  DIALOGUE_HEIGHT_SCALE_RANGE,
  ELEMENT_FITS,
  FONT_SCALE_RANGE,
  NVL_PAGE_SIZE_RANGE,
  TRANSITION_SPEED_RANGE,
  type DialoguePosition,
  type ElementFit,
  type PlayerPreferences,
} from "@lingfan-engine/core";
import {
  checkboxInput,
  disabledPlaceholder,
  prefsRow,
  rangeInput,
  readoutSpan,
  selectInput,
  sliderValue,
} from "./preferences-dom";

/** 扩展控件组的同步句柄 */
export interface PreferenceExtras {
  /** 把当前偏好画到本组所有控件上 */
  sync(): void;
}

/**
 * 在 `root` 上追加扩展控件行，返回同步句柄。`t` 为宿主静态文案查表（缺省恒等）。
 * `fontNames` 为可用字体名清单（缺省空 = 字体档只有「默认」一项）。
 * 行序即追加序：主音量 → 文本 → 显示 → 播放节奏 → 字体 → 缓办禁用占位。
 */
export function buildPreferenceExtras(
  root: HTMLElement,
  preferences: PlayerPreferences,
  t: (text: string) => string,
  fontNames: readonly string[] = [],
): PreferenceExtras {
  const syncers: Array<() => void> = [];

  /** 滑杆行：read 现读、write 回写、format 读数；disabled 可选（如静音时主音量） */
  function addRange(
    setting: string,
    label: string,
    min: number,
    max: number,
    step: number,
    read: () => number,
    write: (value: number) => void,
    format: (value: number) => string,
    disabled?: () => boolean,
  ): void {
    const input = rangeInput(setting, min, max, step);
    input.addEventListener("input", () => write(sliderValue(input)));
    const readout = readoutSpan();
    root.appendChild(prefsRow(label, input, readout));
    syncers.push(() => {
      const value = read();
      input.value = String(value);
      readout.textContent = format(value);
      if (disabled !== undefined) input.disabled = disabled();
    });
  }

  /** 开关行 */
  function addCheckbox(
    setting: string,
    label: string,
    read: () => boolean,
    write: (on: boolean) => void,
  ): void {
    const input = checkboxInput(setting);
    input.addEventListener("change", () => write(input.checked));
    root.appendChild(prefsRow(label, input));
    syncers.push(() => {
      input.checked = read();
    });
  }

  /** 下拉行：值 "" 约定「跟随默认」，write 收到 "" 时由调用方清回三态未设置 */
  function addSelect(
    setting: string,
    label: string,
    options: ReadonlyArray<readonly [string, string]>,
    read: () => string,
    write: (value: string) => void,
  ): void {
    const select = selectInput(setting, options);
    select.addEventListener("change", () => write(select.value));
    root.appendChild(prefsRow(label, select));
    syncers.push(() => {
      select.value = read();
    });
  }

  /** 缓办禁用占位行 */
  function addDisabled(setting: string, label: string, note: string): void {
    root.appendChild(prefsRow(label, disabledPlaceholder(setting, note)));
  }

  const percent = (value: number): string => `${Math.round(value * 100)}%`;

  // —— 音频：主音量（渲染层经 effectiveVolume 自动乘入；静音时禁用，与通道一致）——
  addRange(
    "master-volume",
    t("主音量"),
    0,
    1,
    0.05,
    () => preferences.masterVolume,
    (value) => preferences.setMasterVolume(value),
    percent,
    () => preferences.muted,
  );

  // —— 文本：即时显示（无障碍/效率，只关显示速度不改推进语义）+ NVL 每页行数 ——
  addCheckbox(
    "instant-text",
    t("即时显示文本"),
    () => preferences.instantText,
    (on) => preferences.setInstantText(on),
  );
  addRange(
    "nvl-page-size",
    t("NVL 每页行数"),
    NVL_PAGE_SIZE_RANGE.min,
    NVL_PAGE_SIZE_RANGE.max,
    1,
    () => preferences.nvlPageSize ?? NVL_PAGE_SIZE_RANGE.max,
    (value) => preferences.setNvlPageSize(value),
    (value) => `${Math.round(value)} ${t("行")}`,
  );

  // —— 显示：转场/抖动倍率、减弱动效、字号、对话框外观、元素填充默认 ——
  addRange(
    "transition-speed",
    t("转场速度倍率"),
    TRANSITION_SPEED_RANGE.min,
    TRANSITION_SPEED_RANGE.max,
    0.1,
    () => preferences.transitionSpeed,
    (value) => preferences.setTransitionSpeed(value),
    (value) => `${value.toFixed(1)}×`,
  );
  addRange(
    "shake-scale",
    t("抖动强度"),
    0,
    1,
    0.05,
    () => preferences.shakeScale,
    (value) => preferences.setShakeScale(value),
    percent,
  );
  addSelect(
    "reduced-motion",
    t("减弱动效"),
    [
      ["", t("跟随系统")],
      ["on", t("开")],
      ["off", t("关")],
    ],
    () => {
      const value = preferences.reducedMotion;
      return value === undefined ? "" : value ? "on" : "off";
    },
    (value) => {
      if (value === "") preferences.clearReducedMotion();
      else preferences.setReducedMotion(value === "on");
    },
  );
  addRange(
    "font-scale",
    t("字号倍率"),
    FONT_SCALE_RANGE.min,
    FONT_SCALE_RANGE.max,
    0.05,
    () => preferences.fontScale,
    (value) => preferences.setFontScale(value),
    (value) => `${value.toFixed(2)}×`,
  );
  addRange(
    "dialogue-opacity",
    t("对话框不透明度"),
    0,
    1,
    0.05,
    () => preferences.dialogueOpacity ?? 1,
    (value) => preferences.setDialogueOpacity(value),
    percent,
  );
  addSelect(
    "dialogue-position",
    t("对话框位置"),
    [
      ["", t("默认")],
      ...DIALOGUE_POSITIONS.map((position): readonly [string, string] => [
        position,
        positionLabel(position, t),
      ]),
    ],
    () => preferences.dialoguePosition ?? "",
    (value) => {
      if (value === "") preferences.clearDialoguePosition();
      else preferences.setDialoguePosition(value as DialoguePosition);
    },
  );
  addRange(
    "dialogue-height-scale",
    t("对话框高度倍率"),
    DIALOGUE_HEIGHT_SCALE_RANGE.min,
    DIALOGUE_HEIGHT_SCALE_RANGE.max,
    0.05,
    () => preferences.dialogueHeightScale ?? 1,
    (value) => preferences.setDialogueHeightScale(value),
    (value) => `${value.toFixed(2)}×`,
  );
  addSelect(
    "element-fit",
    t("元素填充默认"),
    [
      ["", t("默认")],
      ...ELEMENT_FITS.map((fit): readonly [string, string] => [fit, fit]),
    ],
    () => preferences.elementFit ?? "",
    (value) => {
      if (value === "") preferences.clearElementFit();
      else preferences.setElementFit(value as ElementFit);
    },
  );

  // 字体档：选项来自构建期字体清单（与 theme-fonts 注入 @font-face 同源）。
  // 值 "" = 跟随工程默认字体；选中值经 applyDialogueAppearance 投影到对话框 CSS 变量，
  // 投影前会再按注册表校验一次，非法/已删字体回退默认而不是静默变字体。
  addSelect(
    "font-family",
    t("字体"),
    [
      ["", t("默认")],
      ...fontNames.map((name): readonly [string, string] => [name, name]),
    ],
    () => preferences.fontFamily ?? "",
    (value) => {
      if (value === "") preferences.clearFontFamily();
      else preferences.setFontFamily(value);
    },
  );

  // —— 播放：自动播放意图、推进延时、阅读速度、快进遇未读即停 ——
  // 四者都由 input-map 的节奏循环实时读：自动播放开关变化即起停循环，
  // 实际停留 = 基础停留 + 该句词元量 / 阅读速度，长句停得久、短句停得短；
  // 未读即停让快进遇未读文本就停手。
  addCheckbox(
    "auto-play",
    t("自动播放"),
    () => preferences.autoEnabled,
    (on) => preferences.setAutoEnabled(on),
  );
  addRange(
    "auto-delay",
    t("自动延时"),
    AUTO_DELAY_MS_RANGE.min,
    AUTO_DELAY_MS_RANGE.max,
    100,
    () => preferences.autoDelayMs,
    (value) => preferences.setAutoDelayMs(value),
    (value) => `${(value / 1000).toFixed(1)} ${t("秒")}`,
  );
  addRange(
    "auto-read-cps",
    t("阅读速度"),
    AUTO_READ_CPS_RANGE.min,
    AUTO_READ_CPS_RANGE.max,
    1,
    () => preferences.autoReadCps,
    (value) => preferences.setAutoReadCps(value),
    (value) => `${value} ${t("词元/秒")}`,
  );
  addCheckbox(
    "skip-unseen",
    t("快进只走已读"),
    () => preferences.skipUnseenOnly,
    (on) => preferences.setSkipUnseenOnly(on),
  );

  // —— 缓办字段：契约已在、消费待后续批，禁用占位 + 说明（不留活控件死配置）——
  addDisabled("type-sound", t("打字音效"), t("待打字机音效接线后启用"));
  addDisabled("window-size", t("窗口尺寸"), t("待桌面壳窗口能力接线后启用"));

  return {
    sync(): void {
      for (const sync of syncers) sync();
    },
  };
}

/** 对话框位置显示名：字面量首参供 i18n 扫描器收键 */
function positionLabel(
  position: DialoguePosition,
  t: (text: string) => string,
): string {
  switch (position) {
    case "bottom":
      return t("底部");
    case "top":
      return t("顶部");
    case "center":
      return t("居中");
  }
}

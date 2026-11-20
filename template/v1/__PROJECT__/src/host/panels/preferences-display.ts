/**
 * 偏好面板的扩展控件组：主音量 + 文本/显示偏好 + 缓办字段禁用占位。
 *
 * 只渲染本批真正接了消费的字段（读写 `PlayerPreferences` 即时生效）；契约已增、
 * 消费尚待后续批的字段（打字音效/窗口尺寸/字体/自动播放/快进）画成禁用占位并附说明，
 * 不留「活控件死配置」。值域一律引用核心契约常量，不在这里抄第二份数字。
 *
 * 与主面板共用 `preferences-dom` 的行构件；本组返回一个 `sync()`，由主面板在
 * 挂载与每次偏好变化时统一调用，控件值与读数都随偏好现读回填。
 */

import {
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
 * 行序即追加序：主音量 → 文本 → 显示 → 缓办禁用占位。
 */
export function buildPreferenceExtras(
  root: HTMLElement,
  preferences: PlayerPreferences,
  t: (text: string) => string,
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

  // —— 缓办字段：契约已在、消费待后续批，禁用占位 + 说明（不留活控件死配置）——
  addDisabled("type-sound", t("打字音效"), t("待打字机音效接线后启用"));
  addDisabled("window-size", t("窗口尺寸"), t("待桌面壳窗口能力接线后启用"));
  addDisabled("font-family", t("字体"), t("待字体注册校验接线后启用"));
  addDisabled("auto-play", t("自动播放"), t("待自动播放接线后启用"));
  addDisabled("skip", t("快进"), t("待快进接线后启用"));

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

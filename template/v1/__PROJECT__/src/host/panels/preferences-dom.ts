/**
 * 偏好面板的低层 DOM 构件（纯原生，无框架）。
 *
 * 这里只放「画一行控件」的机械动作：标签 + 控件 +（可选）读数，以及滑杆/开关/下拉
 * 三种控件的造法。偏好语义（钳制、非法值忽略、三态）一律在 `PlayerPreferences`，
 * 本文件不碰偏好真值，也不自己截断——控件只负责把事件交出去、把现值画回来。
 *
 * 主面板与显示组扩展共用这一份构件，避免两处各画一套行结构。
 */

/**
 * 读滑杆数值：空串按无效处理。
 * `Number("")` 是 0，直接写会把音量误调到静音；返回 NaN 时偏好层忽略该次写入。
 */
export function sliderValue(input: HTMLInputElement): number {
  const raw = input.value;
  return raw === "" ? Number.NaN : Number(raw);
}

/** 一行 = 标签 + 控件 +（可选）数值读数 */
export function prefsRow(
  labelText: string,
  control: HTMLElement,
  readout?: HTMLElement,
): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "prefs-row";
  const label = document.createElement("span");
  label.className = "prefs-label";
  label.textContent = labelText;
  wrapper.appendChild(label);
  wrapper.appendChild(control);
  if (readout !== undefined) wrapper.appendChild(readout);
  return wrapper;
}

/** 造一个滑杆控件（范围/步长由调用方按偏好值域给定） */
export function rangeInput(
  setting: string,
  min: number,
  max: number,
  step: number,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.className = "prefs-range";
  input.dataset.setting = setting;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

/** 造一个开关控件 */
export function checkboxInput(setting: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "prefs-checkbox";
  input.dataset.setting = setting;
  return input;
}

/** 造一个下拉控件；`options` 为 [值, 显示名] 列表，值 "" 约定为「跟随默认」 */
export function selectInput(
  setting: string,
  options: ReadonlyArray<readonly [string, string]>,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "prefs-select";
  select.dataset.setting = setting;
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  return select;
}

/** 数值读数节点 */
export function readoutSpan(): HTMLElement {
  const readout = document.createElement("span");
  readout.className = "prefs-value";
  return readout;
}

/**
 * 造一个禁用占位控件：字段契约已在、消费尚未接线（缓办），画出来但不可操作，
 * 附一句说明，避免「活控件死配置」。`title` 落在节点上供悬停提示。
 */
export function disabledPlaceholder(
  setting: string,
  note: string,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "prefs-checkbox";
  input.dataset.setting = setting;
  input.disabled = true;
  input.title = note;
  return input;
}

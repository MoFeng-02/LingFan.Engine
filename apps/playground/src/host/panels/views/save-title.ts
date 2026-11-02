/**
 * 存档名的取用规则：本示例工程的**创作侧约定**，不是引擎能力。
 *
 * 引擎只认 `SaveDataV1.title` 是一个可选字符串，怎么起名、要不要沿用旧名、
 * 无名字时补什么，全是宿主（创作者）自己的产品口径。所以这套规则住在示例工程里，
 * 换一个作品可以整套换掉而不动引擎与 UI 包。
 *
 * 三条规则按序判定，玩家填了名字就一律以他填的为准（改名也走这里）：
 * 1. 填了名字 → 用填的；
 * 2. 没填、该槽位原来有名字 → 沿用原名（覆盖存档不该顺手把名字抹掉）；
 * 3. 没填、原来也没有 → 自动生成一个。
 */

/**
 * 自动生成的存档名：`存档 11-02 14:47`。
 *
 * 玩家没给名字、槽位里也没有旧名字时才用。做成「存档 + 月日时分」而不是纯时间戳，
 * 是因为槽位行里已经单独显示 `timestamp`，两个字段长得一样就分不出哪个能改。
 * 月份与日期补零，保证名字定长、列表里不跳字。
 */
export function autoSaveTitle(now: number): string {
  const at = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `存档 ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * 一次写盘该用的存档名。
 *
 * 名字只是展示用的标签，写盘本身不依赖它，所以这里永远返回一个字符串、
 * 不返回 undefined——让「字段缺席」只表示读档侧的空层语义，不兼职表达「没起名」。
 */
export function resolveSaveTitle(options: {
  /** 玩家填写的名字（没填是空串或纯空白） */
  typed: string;
  /** 该槽位原有的名字（没有存档，或旧档无此字段） */
  previous: string | undefined;
  /** 生成自动名用的时刻 */
  now: number;
}): string {
  const typed = options.typed.trim();
  if (typed !== "") return typed;
  const previous = options.previous?.trim();
  if (previous !== undefined && previous !== "") return previous;
  return autoSaveTitle(options.now);
}

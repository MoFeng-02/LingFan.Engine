/**
 * 版本号运算：解析、递增、比较，以及发布时该用的 dist-tag。
 *
 * 为什么自己写而不装 semver：这里只需要「主.次.修订 + 可选预发布」的四则运算，
 * 而 semver 包会带进一整棵依赖树。发版脚本跑在每个人的机器上和 CI 上，能被读懂的
 * 一百行胜过看不见的依赖。
 *
 * 不支持构建元数据（`0.1.0-rc.1+build.5` 的 `+build.5` 部分）：npm 发布时会把它
 * 静默裁掉（`"version" was cleaned and set to "0.0.0-rc.1"`），这样 registry 上的
 * 版本号与标签、与仓库内清单三者就对不上，而版本一致性正是这套自检要守的东西。
 * `parseVersion` 认得出构建元数据，`assertReleasable` 负责把它拦下。
 */

/** 正式版本用的 dist-tag。 */
export const LATEST_TAG = "latest";

/**
 * 解析版本号。
 *
 * 严格按 `主.次.修订[-预发布][+构建元数据]` 拆解，不接受 `v` 前缀、范围符号与四段点分
 * （`0.1.1.rc.1` 不是合法语义化版本，正确写法是 `0.1.1-rc.1`）。
 * 非法时返回 undefined，由调用方决定报什么错。
 */
export function parseVersion(text) {
  if (typeof text !== "string") return undefined;
  const matched =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      text,
    );
  if (matched === null) return undefined;
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: matched[4],
    build: matched[5],
  };
}

/** 把解析结果拼回版本号字符串。 */
export function formatVersion(parsed) {
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease === undefined
    ? base
    : `${base}-${parsed.prerelease}`;
}

/**
 * 递增版本。
 *
 * 当前版本带预发布后缀时，任何一档都只清掉后缀、不动主次修订：`0.2.0-rc.1` 的
 * 「下一个补丁」就是 `0.2.0` 本身——预发布是某个正式版本的预览，正式化不该再涨一档。
 */
export function bumpVersion(current, level) {
  const parsed = parseVersion(current);
  if (parsed === undefined) {
    throw new Error(`当前版本 ${String(current)} 不是合法的语义化版本`);
  }
  if (parsed.prerelease !== undefined) {
    return formatVersion({
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch,
    });
  }
  if (level === "major") {
    return formatVersion({ major: parsed.major + 1, minor: 0, patch: 0 });
  }
  if (level === "minor") {
    return formatVersion({
      major: parsed.major,
      minor: parsed.minor + 1,
      patch: 0,
    });
  }
  if (level === "patch") {
    return formatVersion({
      major: parsed.major,
      minor: parsed.minor,
      patch: parsed.patch + 1,
    });
  }
  throw new Error(
    `未知的递增档位：${String(level)}（可用 patch / minor / major）`,
  );
}

/**
 * 比较两个版本：负数表示前者更小。
 *
 * 预发布排序按语义化版本规范：有预发布 < 无预发布；两者都有时逐段比较，纯数字段按数值、
 * 其余按字典序，数字段小于字母段。
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === undefined || b === undefined) {
    throw new Error(`无法比较版本：${String(left)} 与 ${String(right)}`);
  }
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** 逐段比较预发布标识符。 */
function comparePrerelease(left, right) {
  const a = left.split(".");
  const b = right.split(".");
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = a[index];
    const other = b[index];
    if (one === undefined) return -1;
    if (other === undefined) return 1;
    if (one === other) continue;
    const oneIsNumber = /^\d+$/.test(one);
    const otherIsNumber = /^\d+$/.test(other);
    if (oneIsNumber && otherIsNumber)
      return Number(one) < Number(other) ? -1 : 1;
    if (oneIsNumber) return -1;
    if (otherIsNumber) return 1;
    return one < other ? -1 : 1;
  }
  return 0;
}

/**
 * 这个版本发布时该用的 dist-tag。
 *
 * 正式版用 `latest`；预发布版用它的第一段标识（`0.2.0-rc.1` → `rc`）。
 * npm 对预发布版本强制要求显式 `--tag`，不传直接拒绝发布；用第一段而不是固定写
 * `next`，是为了让 `rc` 与 `alpha` 这几种预览在 registry 上互不覆盖。
 */
export function distTagOf(version) {
  const parsed = parseVersion(version);
  if (parsed === undefined) {
    throw new Error(`版本 ${String(version)} 不是合法的语义化版本`);
  }
  if (parsed.prerelease === undefined) return LATEST_TAG;
  const label = /^[A-Za-z][A-Za-z0-9-]*/.exec(parsed.prerelease);
  return label === null ? "prerelease" : label[0];
}

/**
 * 发布前的版本合法性判定。
 *
 * 返回问题描述而不是抛错：调用方要能一次报出全部问题，而不是让人修一个跑一次。
 */
export function assertReleasable(version) {
  const parsed = parseVersion(version);
  if (parsed === undefined) {
    return `版本 ${String(version)} 不是合法的语义化版本（形如 1.2.3 或 1.2.3-rc.1；四段点分的 1.2.3.rc.1 不是合法写法）`;
  }
  if (parsed.build !== undefined) {
    return `版本 ${String(version)} 带构建元数据（+${parsed.build}）：npm 发布会把它裁掉，registry 上的版本号将与标签不一致，请去掉 + 之后的部分`;
  }
  return undefined;
}

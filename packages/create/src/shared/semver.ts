/**
 * 语义化版本运算：解析、比较、取依赖区间的下界。
 *
 * 为什么自己写：生成器只用到这三件事，装 `semver` 会带进一整棵依赖树——而这个包
 * 是随 `npm create` 下载的，为了比两个版本号先拉一棵树不可接受。
 *
 * 与 `scripts/release/version.mjs` 的边界：那是**发布工具链**的版本运算（递增、
 * dist-tag、发布合法性判定），跑在维护者机器与 CI 上；它既不在本包的 `files` 里，
 * 也不是 TypeScript，发布形态的生成器根本 import 不到。两边共用的是语义化版本规范
 * 本身，不是同一份代码——改这里时请对照那一处，别让两套解读漂移。
 */

/** 拆开的版本号；`prerelease` 缺席表示正式版 */
export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease?: string;
}

/**
 * 解析 `主.次.修订[-预发布]`。
 *
 * 不接受 `v` 前缀与构建元数据：前者是标签写法不是版本写法，后者 npm 发布时会裁掉，
 * 让「模板里写的」与「registry 上的」对不上。非法输入返回 undefined，由调用方决定
 * 报什么错——本模块不做措辞。
 */
export function parseSemver(text: string): Semver | undefined {
  const matched =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(
      text.trim(),
    );
  if (matched === null) return undefined;
  const prerelease = matched[4];
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    ...(prerelease === undefined ? {} : { prerelease }),
  };
}

/**
 * 比较两个版本：负数表示前者更小，无法解析时返回 undefined。
 *
 * 预发布按规范排：有预发布 < 无预发布；两者都有时逐段比，纯数字段按数值、
 * 其余按码元序，数字段小于字母段（`0.3.0-rc.2 < 0.3.0-rc.10 < 0.3.0`）。
 */
export function compareSemver(left: string, right: string): number | undefined {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (a === undefined || b === undefined) return undefined;
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** 逐段比较预发布标识符 */
function comparePrerelease(left: string, right: string): number {
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
    if (oneIsNumber && otherIsNumber) {
      return Number(one) < Number(other) ? -1 : 1;
    }
    if (oneIsNumber) return -1;
    if (otherIsNumber) return 1;
    return one < other ? -1 : 1;
  }
  return 0;
}

/**
 * 取依赖区间能接受的**最低**版本；认不出的区间返回 undefined。
 *
 * 只服务一个用途：判断「模板声明的引擎区间」是否容得下模板要求的最低引擎版本。
 * 区间下界是够用的判据——区间上界不影响「装得上最低要求」这件事。
 *
 * 认得的写法：裸版本（`0.3.0`）、`^`、`~`、`>=`、`>`、`=`、`*`（无下界）。
 * 复合区间（`>=0.3.0 <0.5.0`）与 `||` 取第一段的下界——模板里不该出现它们，
 * 真出现了也不该因为「太复杂」而静默放过。
 */
export function floorOfRange(range: string): string | undefined {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "x") return undefined;
  const first = trimmed.split("||")[0]?.trim() ?? "";
  const matched = /^(?:[\^~><=]*)\s*([0-9][0-9A-Za-z.+-]*)/.exec(first);
  if (matched === null) return undefined;
  return parseSemver(matched[1]) === undefined ? undefined : matched[1];
}

/**
 * `version` 是否满足「不低于 `minimum`」。
 *
 * 任一版本号解析不出时返回 undefined：调用方要能把「判不了」与「不达标」分开处理，
 * 前者是模板写错，后者是版本太旧。
 */
export function meetsMinimum(
  version: string,
  minimum: string,
): boolean | undefined {
  const order = compareSemver(version, minimum);
  return order === undefined ? undefined : order >= 0;
}

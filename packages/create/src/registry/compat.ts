/**
 * 模板与引擎的版本兼容判定。
 *
 * 为什么需要：`template-meta.json` 的 `minEngineVersion` 曾是纯声明——没有任何代码读它，
 * 于是「模板用了新引擎才有的 API、而生成的工程装的是旧引擎」这种组合可以一路生成成功，
 * 直到使用者 `pnpm dev` 才炸在一条看不懂的报错上。判据放在生成期，是为了让失败发生在
 * 「还没写盘」的时刻，而不是在别人的工程里。
 *
 * 判定只认 registry 上的**实际**版本：模板声明的区间再漂亮，装不到也是空话。查不到版本
 * （离线）时不做判定——那时模板记录的区间就是将要安装的东西，模板自身的自洽性由
 * `tests/template/template.test.ts` 的静态判据守。
 */
import { compareSemver } from "../shared/index.ts";

/** 引擎包的 scope：本仓发布的包都挂在这里 */
export const ENGINE_SCOPE = "@lingfan-engine/";

/**
 * 判定「这次生成会装到的引擎版本」是否满足模板要求。
 *
 * 返回问题描述而不是抛错：措辞归调用方（CLI 与库对同一件事可以说得不一样），
 * 这里只负责说清「谁、要多少、实际是多少」。
 *
 * `resolved` 为空表示一个版本都没查到（离线或 registry 不可达）——此时无从判定，
 * 返回 undefined 放行，离线生成仍然可用。
 */
export function checkEngineCompatibility(
  minEngineVersion: string,
  resolved: ReadonlyMap<string, string>,
): string | undefined {
  if (resolved.size === 0) return undefined;
  const problems: string[] = [];
  for (const [name, version] of [...resolved].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (!name.startsWith(ENGINE_SCOPE)) continue;
    const order = compareSemver(version, minEngineVersion);
    if (order === undefined) {
      problems.push(`${name}@${version} 无法与 ${minEngineVersion} 比较`);
      continue;
    }
    if (order < 0) problems.push(`${name}@${version}`);
  }
  if (problems.length === 0) return undefined;
  return (
    `模板要求引擎不低于 ${minEngineVersion}，但 registry 上的最新版是 ${problems.join("、")}。` +
    "引擎还没发布这个版本，生成的工程装不上模板需要的 API——先发引擎，或把模板的 minEngineVersion 降到已发布版本。"
  );
}

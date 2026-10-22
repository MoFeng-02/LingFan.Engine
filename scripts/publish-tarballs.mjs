/**
 * 把打包好的 tarball 发布到 registry。
 *
 * 为什么单独成步而不用一句 shell 循环：发布是整条发版流水线里唯一有外部副作用、且不可回滚的
 * 一步。它必须可以「原样再跑一遍」——中途失败（网络抖动、registry 抖动、后面某一步挂了）时，
 * 重跑不能因为「前几个包已经上架」而整体失败，否则只能靠人手动挑出没上架的那几个。
 * 因此这里逐包先问 registry「这个版本在了吗」，在了就跳过，不在才上传。
 *
 * 只做发布，不做打包与校验：tarball 由 `scripts/publish-check.mjs` 产出并验过，
 * 两条命令分工明确，避免「验的是 A、发的是 B」。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PUBLISHED_PACKAGES, packageDirOf } from "./publish-check.mjs";

/**
 * npm 可执行名。
 *
 * Windows 上 `npm` 是 `.cmd` 包装；Linux 与 macOS 上是普通可执行文件。两处都要能跑。
 */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * 调用 npm。
 *
 * Windows 上 `npm` 是 `.cmd`，Node 不允许不带 shell 直接 spawn（EINVAL）；带 `shell: true`
 * 又配 args 数组会触发 DEP0190。与仓库里调用 pnpm 的做法一致：自己拼好命令字符串，
 * 只传字符串、不传 args 数组。
 */
function runNpm(args, options) {
  const quoted = args.map((arg) =>
    /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg,
  );
  return execFileSync(`${NPM} ${quoted.join(" ")}`, {
    ...options,
    shell: true,
  });
}

/** tarball 文件名。`pnpm pack` 按「包名去掉 scope」加版本号命名。 */
export function tarballName(name, version) {
  return `lingfan-engine-${name.replace("@lingfan-engine/", "")}-${version}.tgz`;
}

/** 读某个包自己的清单，取它当前声明的版本。 */
export function manifestOf(name) {
  // packageDirOf 给的是绝对路径，不要再拼仓库根。
  const path = join(packageDirOf(name), "package.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * 这个版本在 registry 上了吗。
 *
 * 用 `npm view` 而不是直接请求 registry：npm 自己处理重试、代理与认证，与随后的 publish
 * 走同一条通道——用别的通道探测，探到的「不在」和 publish 眼里的「不在」可能不是一回事。
 */
export function isPublished(name, version) {
  try {
    const output = runNpm(["view", `${name}@${version}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output === version;
  } catch {
    // 查不到就是没发布过。发布失败会在上一步之外暴露，不靠这里兜。
    return false;
  }
}

/**
 * 逐包发布。
 *
 * `dryRun` 只打印计划，不产生任何外部副作用——供手工触发时先看一眼要发什么。
 * 返回是否全部到位（跳过的也算到位），调用方据此决定流水线成败。
 */
export function publishAll({ keepIn, dryRun = false, log = () => {} } = {}) {
  const results = [];
  for (const name of PUBLISHED_PACKAGES) {
    const manifest = manifestOf(name);
    const version = manifest.version;
    const file = join(keepIn, tarballName(name, version));
    const label = `${name}@${version}`;
    if (!existsSync(file)) {
      results.push({ name, version, action: "missing", ok: false });
      log(`${label}：缺少 tarball，先跑打包自检`);
      continue;
    }
    if (isPublished(name, version)) {
      results.push({ name, version, action: "skipped", ok: true });
      log(`${label}：已在 registry 上，跳过`);
      continue;
    }
    if (dryRun) {
      results.push({ name, version, action: "planned", ok: true });
      log(`${label}：将上传`);
      continue;
    }
    log(`${label}：上传 ${file}`);
    runNpm(["publish", `./${file}`, "--access", "public", "--provenance"], {
      stdio: "inherit",
    });
    results.push({ name, version, action: "published", ok: true });
  }
  return { ok: results.every((item) => item.ok), results };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`, "file:///").href;

if (isMain) {
  const keepIndex = process.argv.indexOf("--keep");
  const keepIn = keepIndex === -1 ? "dist-npm" : process.argv[keepIndex + 1];
  const dryRun = process.argv.includes("--dry-run");
  console.log(`npm ${runNpm(["--version"], { encoding: "utf8" }).trim()}`);
  // OIDC 换证失败时，这一行能区分「没换到证」与「换到证但包被拒」，两种原因的修法完全不同。
  let authEntries = 0;
  try {
    const npmrc = readFileSync(join(process.env.HOME ?? "", ".npmrc"), "utf8");
    authEntries = npmrc
      .split("\n")
      .filter((line) => line.includes("_authToken")).length;
  } catch {
    authEntries = 0;
  }
  console.log(`npmrc 认证条目：${authEntries}`);
  const { ok, results } = publishAll({ keepIn, dryRun, log: console.log });
  const counts = results.reduce(
    (acc, item) => ({ ...acc, [item.action]: (acc[item.action] ?? 0) + 1 }),
    {},
  );
  console.log(
    `发布结论 · ${ok ? "通过" : "失败"}（${Object.entries(counts)
      .map(([action, count]) => `${action} ${count}`)
      .join(" / ")}）`,
  );
  process.exit(ok ? 0 : 1);
}

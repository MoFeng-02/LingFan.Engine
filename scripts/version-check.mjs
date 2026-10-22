/**
 * 版本一致性自检：六个对外包与仓库根声明的版本必须相同，且与本次发行标签对齐。
 *
 * 为什么需要它：这六个包是一套配套件，消费方会同时装 core 与 adapters/ui/shell，
 * 版本错开就会出现「适配器要 core 0.1.2、实际装到 0.1.1」这类无解组合。这类缺陷在
 * 单包视角下完全合法，只有把它们放在一起看才暴露。
 *
 * 为什么标签也要查：标签是发布的触发源，标签与包内版本不一致时，registry 上会出现
 * 「标称 v0.1.2、内容却是 0.1.1」的版本——事后只能补发新版本号来纠正。
 *
 * 本脚本只读仓库内文件与命令行参数，不发网络请求，也不改动任何文件。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 对外发布的包；与发布自检共用同一份清单口径 */
export const VERSIONED_PACKAGES = [
  "@lingfan-engine/core",
  "@lingfan-engine/adapters",
  "@lingfan-engine/ui",
  "@lingfan-engine/shell",
  "@lingfan-engine/editor",
  "@lingfan-engine/stories-build",
];

/** 发行标签前缀。本仓单线版本，所有包同号，因此不需要按包区分前缀。 */
export const TAG_PREFIX = "v";

/**
 * 语义化版本的最小判定。
 *
 * 只认 `主.次.修订` 加可选的预发布/构建元数据，不接受 `v` 前缀与范围符号——
 * 包内的 `version` 字段出现这两者时 registry 会拒收，早报比晚报好。
 */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** 包名转包目录名：`@lingfan-engine/ui` → `packages/ui` */
export function packageDirOf(name) {
  return join(repoRoot, "packages", name.replace("@lingfan-engine/", ""));
}

/** 读出参与版本一致性的全部清单：仓库根 + 六个包 */
export function readManifests() {
  const manifests = [
    {
      label: "仓库根",
      path: join(repoRoot, "package.json"),
      manifest: JSON.parse(
        readFileSync(join(repoRoot, "package.json"), "utf8"),
      ),
    },
  ];
  for (const name of VERSIONED_PACKAGES) {
    const path = join(packageDirOf(name), "package.json");
    manifests.push({
      label: name,
      path,
      manifest: JSON.parse(readFileSync(path, "utf8")),
    });
  }
  return manifests;
}

/**
 * 标签 → 版本号：`v0.1.2` → `0.1.2`。
 *
 * 前缀不符直接报错而不是静默去掉首字符：`release-0.1.2` 这类标签若是被静默接受，
 * 触发条件与版本号之间的约定就失效了。
 */
export function versionOfTag(tag) {
  if (!tag.startsWith(TAG_PREFIX)) {
    return {
      version: undefined,
      problem: `标签 ${tag} 缺少前缀 ${TAG_PREFIX}（约定形如 ${TAG_PREFIX}0.1.2）`,
    };
  }
  return { version: tag.slice(TAG_PREFIX.length), problem: undefined };
}

/**
 * 全部判据。`tag` 为空表示本地自检（只查包之间是否齐）；给定时额外查标签对齐。
 *
 * 返回的是问题清单而非布尔：失败时人要能看到「哪个文件写了什么」，否则只能靠猜。
 */
export function checkVersions({ manifests, tag }) {
  const failures = [];

  const rootEntry = manifests.find((entry) => entry.label === "仓库根");
  if (rootEntry === undefined) {
    failures.push("清单里缺少仓库根 package.json");
  }
  const expected = rootEntry?.manifest.version;

  if (typeof expected !== "string" || !SEMVER_PATTERN.test(expected)) {
    failures.push(`仓库根版本 ${String(expected)} 不是合法的语义化版本`);
  }

  for (const { label, manifest } of manifests) {
    const version = manifest.version;
    if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
      failures.push(`${label}: 版本 ${String(version)} 不是合法的语义化版本`);
      continue;
    }
    if (version !== expected) {
      failures.push(
        `${label}: 版本 ${version} 与仓库根 ${String(expected)} 不一致`,
      );
    }
  }

  if (tag !== undefined) {
    const { version: tagVersion, problem } = versionOfTag(tag);
    if (problem !== undefined) {
      failures.push(problem);
    }
    if (tagVersion !== undefined && tagVersion !== expected) {
      failures.push(
        `标签 ${tag} 指向版本 ${tagVersion}，但仓库内版本是 ${String(expected)}——先改版本再打标签`,
      );
    }
  }

  return failures;
}

/**
 * 从 CI 环境里取出本次运行的发行标签，非标签触发时返回 undefined。
 *
 * 只认 `GITHUB_REF` 的 `refs/tags/` 形态：合入 main 的分支推送里 `GITHUB_REF_NAME`
 * 是分支名（`main`），拿它当标签会立刻触发「标签缺少前缀」的误报——那些运行本来就
 * 不该做标签对账，只该查包之间是否齐。
 */
export function tagFromEnv(env) {
  const ref = env.GITHUB_REF ?? "";
  const prefix = "refs/tags/";
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  // `--tag <标签>`：发布流程显式传入本次触发的标签；不传时按环境推断，
  // 分支推送推断不出标签，就只查包之间是否齐。
  const tagIndex = process.argv.indexOf("--tag");
  const tag =
    tagIndex === -1 ? tagFromEnv(process.env) : process.argv[tagIndex + 1];

  const manifests = readManifests();
  const failures = checkVersions({ manifests, tag });
  const version = manifests[0]?.manifest.version;

  // 逐行印各自的版本而不是统一印根版本：不一致时这张表本身就要能看出差异，
  // 否则人还得回去翻文件才知道是哪一份不对。
  console.log("版本一致性自检（scripts/version-check.mjs）");
  for (const { label, manifest } of manifests) {
    console.log(`  ${label.padEnd(28)} ${String(manifest.version).padEnd(12)}`);
  }
  if (tag !== undefined) console.log(`  触发标签 ${tag}`);

  if (failures.length === 0) {
    console.log(
      `\n  检查结论 · 通过（${manifests.length} 份清单同为 ${String(version)}）`,
    );
  } else {
    console.log(`\n  检查结论 · 失败 ${failures.length} 项：`);
    for (const failure of failures) console.log(`    ${failure}`);
    process.exitCode = 1;
  }
}

/** 供测试复用的仓库根 */
export const repoRootPath = repoRoot;

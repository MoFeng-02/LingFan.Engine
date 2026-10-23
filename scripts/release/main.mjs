/**
 * 一条命令完成一次发版。
 *
 * 用法：
 *   pnpm release --bump patch            把补丁位加一
 *   pnpm release --bump minor            把次版本位加一、补丁归零
 *   pnpm release --bump major            把主版本位加一、次与补丁归零
 *   pnpm release --version 0.2.0-rc.1    指定确切版本（含预发布后缀）
 *   加 --dry-run 只打印计划；加 --no-push 做到打标签为止，不推远端
 *
 * 这条命令负责的部分：算下一个版本 → 写八份清单 → 跑全部门禁 → 提交 → 打注记标签 → 推分支与标签。
 * 推送标签之后的事交给 `.github/workflows/release.yml`：CI 复核、打包自检、OIDC 发布、建 Release。
 * 所以本地这一步**不发布 npm**，也不打包——两处各发布一次会让 registry 与标签对不上。
 *
 * 为什么先门禁后提交：标签指着的提交必须自身是通过的。先提交再跑门禁，一旦失败就要
 * 用 amend 或补提交去补，标签可能已经推出去了。
 */
import { runGates } from "./gates.mjs";
import {
  commit,
  currentBranch,
  hasRemoteTag,
  hasTag,
  isClean,
  push,
  stage,
  tag as createTag,
} from "./git.mjs";
import { currentVersion, writeAll } from "./manifests.mjs";
import { assertReleasable, bumpVersion, distTagOf } from "./version.mjs";

const LEVELS = new Set(["patch", "minor", "major"]);

/** 从命令行读出这次要发什么。 */
function parseArgs(argv) {
  const options = {
    bump: undefined,
    version: undefined,
    dryRun: false,
    push: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--no-push") {
      options.push = false;
    } else if (arg === "--bump") {
      options.bump = argv[(index += 1)];
    } else if (arg.startsWith("--bump=")) {
      options.bump = arg.slice("--bump=".length);
    } else if (arg === "--version") {
      options.version = argv[(index += 1)];
    } else if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
    } else {
      throw new Error(`无法识别的参数：${arg}`);
    }
  }
  if (options.bump === undefined && options.version === undefined) {
    throw new Error("二选一：--bump patch|minor|major 或 --version <版本>");
  }
  if (options.bump !== undefined && options.version !== undefined) {
    throw new Error("--bump 与 --version 只能给一个");
  }
  if (options.bump !== undefined && !LEVELS.has(options.bump)) {
    throw new Error(
      `--bump 只接受 patch / minor / major，收到 ${String(options.bump)}`,
    );
  }
  return options;
}

/** 提交信息。分节写法与仓库既有提交保持一致。 */
function commitMessage(version, before) {
  return [
    `build(发行): 八个包与仓库根统一升到 ${version}`,
    "",
    "新增",
    "",
    `- 无新增包：本次只改版本号，${before} → ${version}。`,
    "",
    "优化",
    "",
    "- 版本号由 `pnpm release` 一条命令推进：改八份清单、跑门禁、提交、打标签、推远端，避免手工漏改其中一份。",
    "",
    "其他变更",
    "",
    `- 发布到 registry 时按版本号自动选 dist-tag：正式版 \`latest\`，预发布版取后缀第一段（当前为 \`${distTagOf(version)}\`）。`,
    "",
  ].join("\n");
}

/**
 * 执行一次发版。
 *
 * 返回退出码：0 成功，1 失败。失败时不动工作区以外的任何东西——
 * 改清单与提交都在门禁之后，门禁失败时清单已写回、提交未发生，人可以直接改代码再跑。
 */
export async function runRelease(argv, { log = () => {} } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    log(String(error instanceof Error ? error.message : error));
    log(
      "用法：pnpm release --bump patch|minor|major | --version <版本> [--dry-run] [--no-push]",
    );
    return 1;
  }

  const before = currentVersion();
  const version =
    options.version === undefined
      ? bumpVersion(before, options.bump)
      : options.version;

  const problem = assertReleasable(version);
  if (problem !== undefined) {
    log(problem);
    return 1;
  }

  const tagName = `v${version}`;
  log(`当前版本 ${before} → 目标版本 ${version}（标签 ${tagName}）`);

  if (hasTag(tagName)) {
    log(`本地已有标签 ${tagName}：先删掉它，或换一个版本号`);
    return 1;
  }
  if (hasRemoteTag(tagName)) {
    log(`远端已有标签 ${tagName}：registry 上这个版本可能已发布，换一个版本号`);
    return 1;
  }

  const branch = currentBranch();
  if (branch !== "main") {
    log(
      `当前分支是 ${branch}：发版必须在 main 上进行（标签会指向 main 上的提交）`,
    );
    return 1;
  }
  // 正式发版要提交，工作区必须先干净；`--dry-run` 不写文件也不提交，脏工作区不该拦住预览。
  if (!options.dryRun && !isClean()) {
    log("工作区有未提交的改动：先提交或清理，否则发版提交会把它们一起带走");
    return 1;
  }

  const paths = writeAll(version, { dryRun: options.dryRun });
  log(
    options.dryRun
      ? `将写入 ${paths.length} 份清单`
      : `清单已更新 ${paths.length} 份`,
  );
  if (options.dryRun) {
    log("--dry-run：到此为止，未跑门禁、未提交、未打标签");
    return 0;
  }

  log("跑门禁…");
  const gates = runGates({ log });
  if (!gates.ok) {
    log(
      `门禁未通过：${String(gates.label)}。清单已改成 ${version}，修完重新跑这条命令`,
    );
    return 1;
  }

  try {
    stage(paths);
    commit(commitMessage(version, before));
    createTag(tagName, tagName);
  } catch (error) {
    log(
      `提交或打标签失败：${String(error instanceof Error ? error.message : error)}`,
    );
    return 1;
  }

  log(`已提交并打标签 ${tagName}（HEAD ${version}）`);
  if (!options.push) {
    log(
      "--no-push：未推远端。手动推送：git push origin main && git push origin " +
        tagName,
    );
    return 0;
  }

  try {
    push({ branch, tagName });
  } catch (error) {
    log(`推送失败：${String(error instanceof Error ? error.message : error)}`);
    log(
      `提交与标签已在本地：确认网络后重跑 git push origin ${branch} && git push origin ${tagName}`,
    );
    return 1;
  }

  log(`已推送 ${branch} 与 ${tagName}：发版流水线会在标签上开始跑`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`, "file:///").href;

if (isMain) {
  const code = await runRelease(process.argv.slice(2), { log: console.log });
  process.exit(code);
}

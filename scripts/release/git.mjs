/**
 * 发版需要的 Git 操作。
 *
 * 为什么单独一层：这些动作都是「读仓库状态」或「写远端」，出错时的修法完全不同
 * （状态不对要人看，写失败多半能重试）。集中在一处，错误信息就能写清是哪一步、
 * 下一步该怎么办。
 *
 * 全部用 `execFileSync` 传参数数组，不拼 shell 字符串：提交信息与路径都可能带空格，
 * 拼字符串在这些地方会静默拆错。
 */
import { execFileSync } from "node:child_process";

/** 跑一条 git 命令，返回 stdout（已去掉首尾空白）。 */
function runGit(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

/** 当前分支名。 */
export function currentBranch() {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** 工作区是否干净（含未跟踪文件）。 */
export function isClean() {
  return runGit(["status", "--porcelain"]) === "";
}

/** 当前提交的短哈希。 */
export function headSha() {
  return runGit(["rev-parse", "--short", "HEAD"]);
}

/** 本地是否已有这个标签。 */
export function hasTag(tag) {
  try {
    runGit(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 远端是否已有这个标签。
 *
 * 查不到（离线、代理不通、远端没配）时返回 `false` 并留给调用方提示：把网络故障当成
 * 「标签已存在」会让人白白换版本号，当成「不存在」则最坏情况是推送被远端拒绝——
 * 后者可以重试，前者会误导人改一个本来没问题的号。
 */
export function hasRemoteTag(tag) {
  try {
    return runGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "";
  } catch {
    return false;
  }
}

/** 仓库里出现过的全部版本类标签（新→旧由调用方自己排）。 */
export function listTags() {
  const output = runGit(["tag", "--list"]);
  return output === "" ? [] : output.split("\n");
}

/** 暂存全部改动。 */
export function stageAll() {
  runGit(["add", "--all"]);
}

/** 暂存（或补暂存）指定路径。 */
export function stage(paths) {
  runGit(["add", "--", ...paths]);
}

/**
 * 提交。
 *
 * 用 `--file -` 从标准输入读提交信息：信息里含多行分节与反引号，走参数会碰上各平台
 * 引号规则的差异；管道是唯一没有歧义的传递方式。
 */
export function commit(message) {
  execFileSync("git", ["commit", "--file", "-"], {
    input: message,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

/** 创建注记标签（`-a` 带说明，`push` 时 registry 与 GitHub 都能看出这是发行点）。 */
export function tag(name, message) {
  runGit(["tag", "-a", name, "-m", message]);
}

/**
 * 推送提交与标签。
 *
 * 先推分支再推标签：分支推送会触发 CI 的常规门禁，标签推送会触发发版流水线。
 * 顺序反了的话，发版会在分支还没更新时开始跑。
 */
export function push({ branch, tagName }) {
  runGit(["push", "origin", branch], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (tagName !== undefined) {
    runGit(["push", "origin", tagName], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
}

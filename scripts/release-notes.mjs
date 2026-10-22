/**
 * 由提交历史生成发布说明。
 *
 * 分组规则与仓库既有的提交信息格式同源：标题形如 `类型(范围): 摘要`，正文分「新增 / 优化 /
 * 修复 / 其他变更」四节。发布说明因此不需要人再手写一遍——提交写对了，说明就是对的；
 * 提交写歪了，说明也会当场露出来。
 *
 * 范围是两个标签之间的提交：上一个标签到本次版本。首个版本没有前标签时取全部历史。
 *
 * 只读 git 历史，不发网络请求，也不改动仓库文件。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 提交类型 → 发布说明分节。未登记的类型归入「其他变更」，不丢弃。 */
const SECTIONS = [
  {
    title: "新增",
    types: ["feat"],
  },
  {
    title: "优化",
    types: ["refactor", "perf", "style", "test", "build"],
  },
  {
    title: "修复",
    types: ["fix"],
  },
  {
    title: "其他变更",
    types: [],
  },
];

/** 标题形如 `feat(发布面): 摘要`，范围可省略 */
const SUBJECT_PATTERN = /^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$/;

/**
 * 从仓库根取提交列表。
 *
 * `from` 为空表示没有前序标签，此时取全部历史。用 `--no-merges` 排除合并提交：
 * 合并提交的标题是分支名，进发布说明只会变成噪音。
 */
export function readCommits({ from, to = "HEAD" } = {}) {
  const range = from === undefined ? to : `${from}..${to}`;
  const output = execFileSync(
    "git",
    ["log", range, "--no-merges", "--pretty=format:%H%x1f%s", "--reverse"],
    { encoding: "utf8" },
  );
  if (output.trim() === "") return [];
  return output.split("\n").map((line) => {
    const [hash, subject] = line.split("\x1f");
    return { hash, subject };
  });
}

/** 解析一条提交标题；不符合约定格式的按「其他变更」处理，原文照录 */
export function parseSubject(subject) {
  const matched = SUBJECT_PATTERN.exec(subject);
  if (matched === null) {
    return {
      type: undefined,
      scope: undefined,
      summary: subject,
      conventional: false,
    };
  }
  return {
    type: matched[1],
    scope: matched[2],
    summary: matched[3],
    conventional: true,
  };
}

/** 提交类型落在哪一节；未登记的类型归入最后一节 */
export function sectionOf(type) {
  if (type !== undefined) {
    for (const section of SECTIONS) {
      if (section.types.includes(type)) return section.title;
    }
  }
  return SECTIONS[SECTIONS.length - 1].title;
}

/**
 * 生成 markdown。
 *
 * 空节直接省略：只有一个节有内容时还印四个标题，读的人会以为其余三节漏了内容。
 * 每条带短哈希，便于从发布说明跳回提交。
 *
 * 末尾保留一个换行：调用方常用 `cat` 把它拼进别的内容里，没有结尾换行就会和下一行粘连。
 */
export function renderNotes({ version, commits }) {
  const grouped = new Map(SECTIONS.map((section) => [section.title, []]));
  for (const { hash, subject } of commits) {
    const parsed = parseSubject(subject);
    const title = sectionOf(parsed.type);
    const label = parsed.scope === undefined ? "" : `**${parsed.scope}**：`;
    grouped
      .get(title)
      .push(`- ${label}${parsed.summary}（${hash.slice(0, 7)}）`);
  }

  const lines = [`## v${version}`, ""];
  for (const section of SECTIONS) {
    const items = grouped.get(section.title);
    if (items.length === 0) continue;
    lines.push(`### ${section.title}`, "", ...items, "");
  }
  const total = commits.length;
  lines.push(total === 0 ? "本次没有代码提交。" : `共 ${total} 条提交。`);
  return `${lines.join("\n")}\n`;
}

/** 当前提交上的标签。用来把它们排除出「上一个标签」的搜索。 */
function tagsAtHead() {
  try {
    const output = execFileSync("git", ["tag", "--points-at", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

/**
 * 取上一个标签作为提交范围的起点。
 *
 * 必须排除「指向当前提交的标签」：发布流水线检出的正是打了本次标签的提交，不排除的话
 * `describe` 会把这个标签自己返回回来，范围退化成空区间，发布说明就变成「没有提交」。
 *
 * 找不到更早的标签时返回 undefined（首个版本取全部历史）。stderr 一并丢弃：没有标签是
 * 正常状态，不该在日志里留下一条看着像失败的 `fatal:`。
 */
export function previousTag() {
  const excluded = tagsAtHead().flatMap((tag) => ["--exclude", tag]);
  try {
    const output = execFileSync(
      "git",
      ["describe", "--tags", "--abbrev=0", ...excluded],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return output === "" ? undefined : output;
  } catch {
    return undefined;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const versionIndex = process.argv.indexOf("--version");
  // `--version` 缺省时读仓库根版本：本地预览说明不该需要人再手抄一遍版本号。
  const version =
    versionIndex === -1
      ? JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version
      : process.argv[versionIndex + 1];
  if (version === undefined || version === "") {
    console.error(
      "用法：node scripts/release-notes.mjs [--version <版本号>] [--from <标签>]",
    );
    process.exit(1);
  }
  // `--from` 缺省时自动找上一个标签：跳过指向当前提交的标签，否则范围会是空的。
  const fromIndex = process.argv.indexOf("--from");
  const from = fromIndex !== -1 ? process.argv[fromIndex + 1] : previousTag();
  process.stdout.write(
    renderNotes({ version, commits: readCommits({ from }) }),
  );
}

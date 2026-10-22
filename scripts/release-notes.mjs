/**
 * 由提交历史生成发布说明。
 *
 * 素材直接取提交本身：标题形如 `类型(范围): 摘要`，正文按「新增 / 优化 / 修复 / 其他变更」
 * 分节。正文里的条目就是发布说明的条目——提交写对了，说明就是对的；提交写歪了，说明也会
 * 当场露出来。只读标题会丢掉正文里那些「改了什么、为什么、对使用者有什么影响」的说明，
 * 发布说明退化成一行行摘要，读的人还得逐个翻提交。
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

/** 正文里的裸分节标题：`新增`、`修复：` 单独占一行 */
const BARE_SECTION_PATTERN = /^\s*(新增|优化|修复|其他变更)\s*[:：]?\s*$/;

/** 正文里的 markdown 分节标题：`### 优化` */
const MARKDOWN_SECTION_PATTERN = /^\s*#{1,6}\s+(.+?)\s*[:：]?\s*$/;

/**
 * 正文里的自定分节标题：短、以冒号收尾，如 `重构：`。
 *
 * 限长是为了把标题与普通句子分开——正文里的说明常以句号收尾且远超这个长度，不会被误认。
 * 认出来但不在四节之内的标题落到「其他变更」，比整段正文被丢掉更接近事实。
 */
const COLON_SECTION_PATTERN = /^\s*([^\s:：#][^:：]{0,11})[:：]\s*$/;

/** 正文里的列表条目 */
const BODY_BULLET_PATTERN = /^\s*[-*]\s+(.*)$/;

/** 一条提交在 git 输出里的字段分隔符与记录分隔符 */
const FIELD_SEPARATOR = "\u001f";
const RECORD_SEPARATOR = "\u001e";

/**
 * 从仓库根取提交列表。
 *
 * `from` 为空表示没有前序标签，此时取全部历史。用 `--no-merges` 排除合并提交：
 * 合并提交的标题是分支名，进发布说明只会变成噪音。
 *
 * 正文一并取出：它是发布说明的主要素材。记录之间用 `\u001e` 分隔，因为正文本身是多行的，
 * 靠换行切不出边界。
 */
export function readCommits({ from, to = "HEAD" } = {}) {
  const range = from === undefined ? to : `${from}..${to}`;
  const output = execFileSync(
    "git",
    [
      "log",
      range,
      "--no-merges",
      "--pretty=format:%H%x1f%s%x1f%b%x1e",
      "--reverse",
    ],
    { encoding: "utf8" },
  );
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const fields = record.split(FIELD_SEPARATOR);
      return {
        hash: fields[0],
        subject: fields[1],
        body: fields[2] ?? "",
      };
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

/**
 * 把提交正文拆成「分节 → 条目」。
 *
 * 分节标题之下，列表条目各成一条，正文段落也各成一条；没有分节标题的正文全部落在空串
 * 这个键下，由调用方决定归到哪一节。正文常见的三种形态——分节加列表、只有列表、只有
 * 段落——都能取出条目，不会因为少写一个小圆点就整段丢掉。
 *
 * 条目常按 80 列折行，紧跟其后的普通行属于上一条，需要接回去。接缝处补一个空格的条件是
 * 「两侧任一以 ASCII 词字符结尾或开头」，中文之间不补——中文不需要空格分词，补了反而断开。
 */
export function parseBodySections(body) {
  const sections = new Map();
  if (typeof body !== "string" || body.trim() === "") return sections;

  const itemsOf = (key) => {
    if (!sections.has(key)) sections.set(key, []);
    return sections.get(key);
  };

  let current = "";
  let hasItem = false;
  let afterBlank = true;
  for (const line of body.split("\n")) {
    const heading = sectionHeading(line);
    if (heading !== undefined) {
      current = heading;
      itemsOf(current);
      hasItem = false;
      afterBlank = true;
      continue;
    }
    if (line.trim() === "") {
      afterBlank = true;
      continue;
    }

    const items = itemsOf(current);
    const bullet = BODY_BULLET_PATTERN.exec(line);
    if (bullet !== null) {
      items.push(bullet[1].trim());
      hasItem = true;
      afterBlank = false;
      continue;
    }

    const text = line.trim();
    if (!hasItem || afterBlank) {
      items.push(text);
      hasItem = true;
      afterBlank = false;
      continue;
    }

    const previous = items[items.length - 1];
    const glue = /[\w`]$/.test(previous) || /^[\w`]/.test(text) ? " " : "";
    items[items.length - 1] = `${previous}${glue}${text}`;
  }
  return sections;
}

/**
 * 认出正文里的分节标题，返回它归一后的节名；不是标题返回 undefined。
 *
 * 三种写法都认：裸标题（`修复`）、markdown 标题（`### 优化`）、自定标题（`重构：`）。
 * 自定的名字原样返回，由调用方决定它落到哪一节——认出来总比当成正文段落吞掉好。
 */
function sectionHeading(line) {
  const bare = BARE_SECTION_PATTERN.exec(line);
  if (bare !== null) return bare[1];

  const markdown = MARKDOWN_SECTION_PATTERN.exec(line);
  if (markdown !== null) {
    const title = markdown[1].trim();
    const known = BARE_SECTION_PATTERN.exec(title);
    return known === null ? title : known[1];
  }

  const colon = COLON_SECTION_PATTERN.exec(line);
  if (colon !== null) {
    const title = colon[1].trim();
    const known = BARE_SECTION_PATTERN.exec(title);
    return known === null ? title : known[1];
  }
  return undefined;
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
 * 素材顺序是「有正文就用正文，没正文才退回标题」：正文条目按投稿时写的分节落位，没写分节
 * 的正文按提交类型落位，只有正文为空才用标题摘要。这样发布说明写的是「改了什么、为什么」，
 * 而不是一行行标题复述。
 *
 * 每条都带范围前缀与短哈希，读的人能看出它属于哪次改动、也能跳回提交核对。
 *
 * 空节直接省略：只有一个节有内容时还印四个标题，读的人会以为其余三节漏了内容。
 *
 * 末尾保留一个换行：调用方常用 `cat` 把它拼进别的内容里，没有结尾换行就会和下一行粘连。
 */
export function renderNotes({ version, commits, repoSlug, previousTag }) {
  const grouped = new Map(SECTIONS.map((section) => [section.title, []]));
  for (const { hash, subject, body } of commits) {
    const parsed = parseSubject(subject);
    const label = parsed.scope === undefined ? "" : `**${parsed.scope}**：`;
    const suffix = `（${hash.slice(0, 7)}）`;
    const bodySections = parseBodySections(body);

    if (bodySections.size > 0) {
      for (const [title, items] of bodySections) {
        // 无标题的正文按提交类型落位；写了标题但不在四节之内的落进其他变更。
        const bucket =
          grouped.get(title === "" ? sectionOf(parsed.type) : title) ??
          grouped.get("其他变更");
        for (const item of items) bucket.push(`- ${label}${item}${suffix}`);
      }
      continue;
    }

    grouped
      .get(sectionOf(parsed.type))
      .push(`- ${label}${parsed.summary}${suffix}`);
  }

  const lines = [`## v${version}`, ""];
  for (const section of SECTIONS) {
    const items = grouped.get(section.title);
    if (items.length === 0) continue;
    lines.push(`### ${section.title}`, "", ...items, "");
  }

  const total = commits.length;
  lines.push(total === 0 ? "本次没有代码提交。" : `共 ${total} 条提交。`, "");

  // 对比链接只在真有上一个标签时给：首个版本没有可比的起点，起点等于终点时那条链接
  // 点开是空 diff，比不印更让人困惑。
  const next = `v${version}`;
  if (
    repoSlug !== undefined &&
    previousTag !== undefined &&
    previousTag !== next
  ) {
    lines.push(
      `**完整变更**：[${previousTag}...${next}](https://github.com/${repoSlug}/compare/${previousTag}...${next})`,
      "",
    );
  }
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

/**
 * 取 `owner/repo`，用来拼「完整变更」的对比链接。
 *
 * 流水线里由 `GITHUB_REPOSITORY` 给出，本地则从 `origin` 的地址里解析：两处都拿不到时
 * 返回 undefined，此时不输出对比链接——宁可少一行，也不要印一个点不开的地址。
 */
export function repoSlug() {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv.trim();
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const matched = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
    return matched === null ? undefined : `${matched[1]}/${matched[2]}`;
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
      "用法：node scripts/release-notes.mjs [--version <版本号>] [--from <标签>] [--to <引用>]",
    );
    process.exit(1);
  }
  // `--from` 缺省时自动找上一个标签：跳过指向当前提交的标签，否则范围会是空的。
  const fromIndex = process.argv.indexOf("--from");
  const from = fromIndex !== -1 ? process.argv[fromIndex + 1] : previousTag();
  // `--to` 缺省是 HEAD。补建历史标签的发布说明时，范围终点是该标签而不是当前提交。
  const toIndex = process.argv.indexOf("--to");
  const to = toIndex !== -1 ? process.argv[toIndex + 1] : "HEAD";
  process.stdout.write(
    renderNotes({
      version,
      commits: readCommits({ from, to }),
      repoSlug: repoSlug(),
      previousTag: from,
    }),
  );
}

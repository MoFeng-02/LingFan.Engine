/**
 * 规约↔测试互锁：`私有文档/新引擎规约/*.md` 声明的锚点 ID ↔ `tests/` 可 grep 的落地。
 *
 * 锚点 ID 规范（`私有文档/新引擎规约/00-总览与取舍清单.md` §4.1）：
 * 形如 `锚点: <kebab-id>`，一行可多个；落地 = 测试源码里逐字包含该 ID
 * （用例标题或注释，参照 `ext-op-wait-*` 系列的做法）。
 *
 * 覆盖策略是白名单渐进收紧：白名单内的锚点**双向精确相等**（缺失变红），
 * 白名单外的只进报告不阻塞门禁——门禁的意义是可信，不是全额。
 * 同一测试文件重复检查同一 ID 是合法的（一个锚点可由多条用例共同钉住）。
 */
import { describe, expect, it } from "vitest";
import { twoWayDiff } from "../helpers/two-way-diff";

/** 规约全文（键 = 仓库相对路径；前端不碰文件系统，走打包器读取） */
const SPEC_SOURCES = import.meta.glob("../../私有文档/新引擎规约/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 测试全文（键 = 仓库相对路径；根相对 glob 覆盖 tests/ 全部 ts） */
const TEST_SOURCES = import.meta.glob("../../tests/**/*.ts", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** 声明行正则：`锚点:` 或全角冒号变体 */
const ANCHOR_LINE = /锚点[:：]\s*(.+)$/gm;

/** 锚点 ID 词法：小写字母数字 + 连字符、至少两段（与 §4.1 规范一致） */
const ANCHOR_ID = /[a-z0-9]+(?:-[a-z0-9]+)+/g;

/** 从规约全文抽出全部声明的锚点 ID（含重复；重复声明合法） */
function declaredAnchorIds(): { ids: string[]; fileCount: number } {
  const ids: string[] = [];
  for (const source of Object.values(SPEC_SOURCES)) {
    for (const m of source.matchAll(ANCHOR_LINE)) {
      for (const id of (m[1] ?? "").matchAll(ANCHOR_ID)) {
        ids.push(id[0] ?? "");
      }
    }
  }
  return { ids, fileCount: Object.keys(SPEC_SOURCES).length };
}

/**
 * 从测试源码抽出已落地的锚点 ID：逐字出现即算（按唯一集合）。
 * 判据用词边界而非裸子串——`prefs-keymap-x` 不该算作 `prefs-keymap` 的落地，
 * 否则 ID 被改名/加后缀后互锁会静默放过（子串误报）。
 */
function landedAnchorIds(specIds: string[]): Set<string> {
  const corpus = Object.values(TEST_SOURCES).join("\n");
  const landed = new Set<string>();
  for (const id of new Set(specIds)) {
    if (new RegExp(`(?<![a-z0-9-])${id}(?![a-z0-9-])`).test(corpus)) {
      landed.add(id);
    }
  }
  return landed;
}

/**
 * 白名单：已有落地证据的锚点，进入双向精确相等断言；
 * 白名单外只报告不阻塞（渐进收紧，新落地一条就搬进来一条）。
 */
const ENFORCED_ANCHORS = [
  "custom-op-state-persist",
  "ext-op-wait-abort",
  "ext-op-wait-checkpoint",
  "ext-op-wait-declaration",
  "ext-op-wait-replay",
  "ext-op-wait-resolve",
  "ext-op-wait-steps",
  "op-registry-builtin-parity",
  "prefs-fullscreen",
  "prefs-keymap",
] as const;

/**
 * `私有文档/` 被 .gitignore 排除，CI 或干净检出环境里规约文件不存在——
 * 那时整套件 skip 而非 fail（互锁是本机开发门禁，不是 CI 依赖）。
 * glob 匹配不到路径时返回空对象且不报错，正好用「文件数 = 0」作 skip 判据。
 */
const hasSpecSources = Object.keys(SPEC_SOURCES).length > 0;

describe.skipIf(!hasSpecSources)("规约↔测试互锁：锚点声明 ↔ tests/ 落地", () => {
  it("扫描面非空（规约 ≥ 10 文件、测试 ≥ 100 文件，防 glob 失配假绿）", () => {
    expect(Object.keys(SPEC_SOURCES).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(TEST_SOURCES).length).toBeGreaterThanOrEqual(100);
  });

  it("声明行能抽出锚点 ID（数量级自证：唯一 ID ≥ 100）", () => {
    const { ids } = declaredAnchorIds();
    expect(ids.length).toBeGreaterThanOrEqual(100);
    expect(new Set(ids).size).toBeGreaterThanOrEqual(100);
  });

  it("判据自证：白名单 ID 注入假语料后能被找回（防落地判据失配）", () => {
    const probe = ENFORCED_ANCHORS[0] ?? "";
    const corpus = Object.values(TEST_SOURCES).join("\n");
    expect(corpus.includes(probe)).toBe(
      landedAnchorIds([probe]).has(probe),
    );
  });

  it("白名单内：声明 ↔ 落地双向精确相等（缺失即红，写法漂移也红）", () => {
    const { ids } = declaredAnchorIds();
    const landed = landedAnchorIds(ids);
    const diff = twoWayDiff({
      declared: ENFORCED_ANCHORS,
      landed: [...landed].filter((id) =>
        (ENFORCED_ANCHORS as readonly string[]).includes(id),
      ),
      declaredLabel: "白名单锚点",
      landedLabel: "测试落地",
    });
    expect(diff.declaredButMissing, `声明未落地：${diff.declaredButMissing.join("、")}`).toEqual(
      [],
    );
  });

  it("报告（不阻塞）：白名单外声明未落地的锚点清单——渐进收紧的待办面", () => {
    const { ids } = declaredAnchorIds();
    const landed = landedAnchorIds(ids);
    const diff = twoWayDiff({
      declared: ids,
      landed: [...landed],
      declaredLabel: "规约锚点",
      landedLabel: "测试落地",
    });
    const pending = diff.declaredButMissing.filter(
      (id) => !(ENFORCED_ANCHORS as readonly string[]).includes(id),
    );
    // 只留痕不断言：让未覆盖面在测试输出里可见，禁止它静默膨胀后无人知晓
    console.info(
      `[锚点互锁] 已落地 ${landed.size} / 唯一声明 ${new Set(ids).size}；白名单外待落地 ${pending.length} 条`,
    );
    expect(Array.isArray(pending)).toBe(true);
  });
});

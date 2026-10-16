/**
 * audit-frontmatter · head 元信息（title/description/canonical/OG）与站名
 */
import {
  DESC_MAX,
  SITE_NAME,
  SITE_ORIGIN,
  TITLE_MAX,
  cpLen,
  fail,
  pass,
  rows,
} from "./shared.ts";

// ================================================================ A · title
const titleLong = rows.filter((r) => cpLen(r.title) > TITLE_MAX);
if (!titleLong.length) {
  const max = Math.max(...rows.map((r) => cpLen(r.title)));
  pass(
    "A3-1",
    "A",
    `每页 <title> ≤ ${TITLE_MAX} 字符`,
    "拦截",
    `${rows.length} 页全部合规，最长 ${max} 字符`,
    `最长页：${rows.find((r) => cpLen(r.title) === max).url} → 「${rows.find((r) => cpLen(r.title) === max).title}」`,
  );
} else {
  fail(
    "A3-1",
    "A",
    `每页 <title> ≤ ${TITLE_MAX} 字符`,
    "拦截",
    `${titleLong.length} 页超限`,
    titleLong.map((r) => `${r.url} (${cpLen(r.title)})`).join(", "),
  );
}

for (const lang of ["zh", "en"]) {
  const set = rows.filter((r) => r.en === (lang === "en"));
  const seen = new Map();
  for (const r of set) seen.set(r.title, [...(seen.get(r.title) || []), r.url]);
  const dup = [...seen.entries()].filter(([, v]) => v.length > 1);
  const label = lang === "zh" ? "简体中文" : "English";
  if (!dup.length) {
    pass(
      `A3-2-${lang}`,
      "A",
      `${label}侧 title 唯一`,
      "拦截",
      `${set.length} 页 title 全部唯一`,
      "",
    );
  } else {
    fail(
      `A3-2-${lang}`,
      "A",
      `${label}侧 title 唯一`,
      "拦截",
      `${dup.length} 组重复`,
      dup.map(([t, v]) => `「${t}」→ ${v.join(" / ")}`).join("; "),
    );
  }
}
// en fallback 页继承 zh 的 title 属 Starlight 预期回退行为，跨语言同名单独记录为信息项
{
  const seen = new Map();
  for (const r of rows)
    seen.set(r.title, [...(seen.get(r.title) || []), r.url]);
  const cross = [...seen.entries()].filter(
    ([, v]) =>
      v.length > 1 &&
      v.some((u) => u.startsWith("/en/")) &&
      v.some((u) => !u.startsWith("/en/")),
  );
  pass(
    "A3-2-x",
    "A",
    "跨语言同名 title（en fallback 继承 zh）",
    "建议",
    `${cross.length} 组：en 侧未翻译页复用 zh 的 title/description，属既定的自动回退行为，非缺陷`,
    cross.length ? `例：「${cross[0][0]}」→ ${cross[0][1].join(" / ")}` : "",
  );
}

const noName = rows.filter((r) => !r.title.includes(SITE_NAME));
if (!noName.length) {
  pass(
    "H2-1",
    "H",
    `每页 <title> 含站名「${SITE_NAME}」`,
    "拦截",
    `${rows.length} 页全部命中`,
    "",
  );
} else {
  fail(
    "H2-1",
    "H",
    `每页 <title> 含站名「${SITE_NAME}」`,
    "拦截",
    `${noName.length} 页缺站名`,
    noName.map((r) => `${r.url} → 「${r.title}」`).join(", "),
  );
}

// ============================================================ A · description
const noDesc = rows.filter((r) => !r.desc.trim());
if (!noDesc.length) {
  pass(
    "A3-3",
    "A",
    "description 覆盖率 100%",
    "拦截",
    `${rows.length} 页全部有 <meta name="description">`,
    "",
  );
} else {
  fail(
    "A3-3",
    "A",
    "description 覆盖率 100%",
    "拦截",
    `${noDesc.length} 页缺失`,
    noDesc.map((r) => r.url).join(", "),
  );
}

const descLong = rows.filter((r) => cpLen(r.desc) > DESC_MAX);
if (!descLong.length) {
  const max = Math.max(...rows.map((r) => cpLen(r.desc)));
  pass(
    "A3-4",
    "A",
    `description ≤ ${DESC_MAX} 字符`,
    "必修",
    `${rows.length} 页全部合规，最长 ${max} 字符`,
    "",
  );
} else {
  fail(
    "A3-4",
    "A",
    `description ≤ ${DESC_MAX} 字符`,
    "必修",
    `${descLong.length} 页超限`,
    descLong.map((r) => `${r.url} (${cpLen(r.desc)} 字符)`).join(", "),
  );
}

{
  const m = new Map();
  for (const r of rows) m.set(r.desc, [...(m.get(r.desc) || []), r.url]);
  const dup = [...m.entries()].filter(([, v]) => v.length > 1);
  if (!dup.length) {
    pass(
      "A3-5",
      "A",
      "description 全局唯一",
      "建议",
      `${rows.length} 页无重复`,
      "",
    );
  } else {
    const enOnly = dup.every(([, v]) => v.every((u) => u.startsWith("/en/")));
    fail(
      "A3-5",
      "A",
      "description 全局唯一",
      "建议",
      `${dup.length} 组重复${enOnly ? "（全部为 en fallback 继承 zh，预期回退行为）" : ""}`,
      dup
        .slice(0, 8)
        .map(([d, v]) => `${v.join(" / ")} ← 「${d.slice(0, 36)}…」`)
        .join("; "),
    );
  }
}

const badCanon = rows.filter((r) => !r.canonical.startsWith(SITE_ORIGIN));
if (!badCanon.length) {
  pass(
    "A3-6",
    "A",
    "canonical 指向正式站点前缀",
    "必修",
    `${rows.length} 页均以 ${SITE_ORIGIN} 开头`,
    "",
  );
} else {
  fail(
    "A3-6",
    "A",
    "canonical 指向正式站点前缀",
    "必修",
    `${badCanon.length} 页异常`,
    badCanon.map((r) => `${r.url} → ${r.canonical || "(缺失)"}`).join(", "),
  );
}

const noOg = rows.filter((r) => !r.ogTitle || !r.ogDesc);
if (!noOg.length) {
  pass(
    "A3-7",
    "A",
    "og:title / og:description 全覆盖",
    "建议",
    `${rows.length} 页齐备`,
    "",
  );
} else {
  fail(
    "A3-7",
    "A",
    "og:title / og:description 全覆盖",
    "建议",
    `${noOg.length} 页缺失`,
    noOg.map((r) => r.url).join(", "),
  );
}

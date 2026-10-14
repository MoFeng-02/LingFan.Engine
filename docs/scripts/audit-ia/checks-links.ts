/**
 * audit-ia · A5 内部断链（全站）
 */
import { readFileSync } from "node:fs";
import { BASE, fail, htmlLinks, idsOf, pass, pages, resolveLink } from "./shared.ts";

const broken = [];
const fragBroken = [];
for (const l of htmlLinks) {
  if (!l.href.startsWith(BASE)) continue;
  const r = resolveLink(l.href);
  if (!r.file) {
    broken.push(`${l.url} → ${l.href}`);
    continue;
  }
  if (r.frag && r.file.endsWith(".html")) {
    const target = readFileSync(r.file, "utf8");
    const frag = decodeURIComponent(r.frag);
    if (!idsOf(target).has(frag)) fragBroken.push(`${l.url} → ${l.href}`);
  }
}
const nonBase = htmlLinks.filter(
  (l) => l.href.startsWith("/") && !l.href.startsWith(BASE),
);
if (!broken.length && !fragBroken.length && !nonBase.length) {
  pass(
    "A5-1",
    "A",
    "内部断链 0（含 #锚点级与 base 前缀一致性）",
    "拦截",
    `扫描 ${pages.length} 页 ${htmlLinks.length} 条 href/src：文件级 0 断链、锚点级 0 断链、未加 base 前缀 0 处`,
    `验证依据：全站扫描 (?:href|src)="(/[^"]*)" 排除 ${BASE}* ⇒ 0 命中`,
  );
} else {
  fail(
    "A5-1",
    "A",
    "内部断链 0（含 #锚点级与 base 前缀一致性）",
    "拦截",
    `文件级 ${broken.length} / 锚点级 ${fragBroken.length} / 缺 base 前缀 ${nonBase.length}`,
    `${broken.slice(0, 8).join("; ")} ${fragBroken.slice(0, 8).join("; ")} ${nonBase
      .slice(0, 8)
      .map((l) => `${l.url} → ${l.href}`)
      .join("; ")}`,
  );
}

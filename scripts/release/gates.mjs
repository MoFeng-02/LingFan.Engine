/**
 * 发版前的门禁：类型检查、代码风格、单元测试、运行期可达图检查。
 *
 * 为什么发版脚本自己跑一遍：这套检查在 CI 里也有，但发版是本地发起的一次性动作，
 * 等 CI 报错再回头修，代价是「标签已经推出去、流水线已经红了」——标签指向一个
 * 不通过的提交，事后只能补发新版本。所以宁可在这里多花两分钟。
 *
 * 用 `execFileSync` 配 `stdio: "inherit"`：门禁的失败信息就是给人看的，没必要
 * 抓进内存再原样打印（还会在失败时丢掉上文的进度条与颜色）。
 */
import { execFileSync } from "node:child_process";

/**
 * 门禁清单。
 *
 * `command` 用 pnpm：本仓的门禁定义都在 `package.json` 的 scripts 里，直接调它们
 * 才与人在本地敲的命令一致；在这里重写一遍命令串，等于开了第二份定义。
 */
export const GATES = [
  { label: "版本一致性", command: "node", args: ["scripts/version-check.mjs"] },
  { label: "类型检查", command: "pnpm", args: ["typecheck"] },
  { label: "代码风格", command: "pnpm", args: ["lint"] },
  { label: "单元测试", command: "pnpm", args: ["test:unit"] },
  { label: "运行期可达图检查", command: "pnpm", args: ["audit:runtime"] },
];

/**
 * 依次跑全部门禁，遇到第一个失败就停。
 *
 * 不在失败后继续跑其余的：后面的失败多半是同一个根因的余波，一次性全跑完只会
 * 把真正的第一条错误淹在后面。
 * 返回 `{ ok, label }`，`label` 是失败的那一道（全部通过时为 undefined）。
 */
export function runGates({ log = () => {} } = {}) {
  for (const gate of GATES) {
    log(`  ${gate.label}…`);
    try {
      execFileSync(gate.command, gate.args, {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
    } catch {
      return { ok: false, label: gate.label };
    }
  }
  return { ok: true, label: undefined };
}

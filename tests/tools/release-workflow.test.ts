import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * 发版工作流的判据：发布动作必须只在标签上发生。
 *
 * 背景：`workflow_dispatch` 是为了「演练」而加的，默认值 `dry_run: true` 只表示
 * 「默认不发布」，不表示「不能发布」——手工触发的界面上，那个勾是可以被取消的。
 * 一旦取消，工作流的 ref 是分支，`publish` 就会真的把包推上 registry，而 git 里
 * 没有任何标签与之对应，「发了什么」与「标签是什么」这条对应关系当场断掉。
 *
 * 判据只锁一件事：`publish` 里的发布步骤同时受 `dry_run` 与 `ref_type` 约束。
 * 用文本断言而不是引 YAML 解析器：工作流是少量固定结构，加一个依赖不划算，
 * 而且这里的重点是「那一行条件在不在」，不是 YAML 语义。
 *
 * 注意断言必须限定在 job 内部：两个 job 的步骤缩进相同，按「下一个步骤」截取
 * 会跨过 job 边界，把 `release` job 里的同名单写条件算进来，等于什么都没测。
 */
const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

/** 取 `\n  <job>:` 到下一个同级 job 之前的片段。 */
function jobBlock(job: string): string {
  const marker = `\n  ${job}:`;
  const start = workflow.indexOf(marker);
  expect(start, `工作流里找不到 job「${job}」`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/\n  [a-z][\w-]*:/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** 在给定 job 片段里取某个步骤块，到该 job 内下一个步骤之前。 */
function stepBlock(job: string, name: string): string {
  const body = jobBlock(job);
  const start = body.indexOf(`- name: ${name}`);
  expect(start, `job「${job}」里找不到步骤「${name}」`).toBeGreaterThan(-1);
  const rest = body.slice(start);
  const next = rest.indexOf("\n      - name:", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("发版工作流 · 发布条件", () => {
  it("发布步骤只在标签触发时执行", () => {
    expect(stepBlock("publish", "发布")).toContain("github.ref_type == 'tag'");
  });

  it("发布步骤仍受演练开关约束：勾了 dry_run 就不发布", () => {
    expect(stepBlock("publish", "发布")).toContain("!inputs.dry_run");
  });

  it("建 Release 与发布用同一套条件，不会出现「发了包但没有标签」的单边状态", () => {
    const releaseJob = jobBlock("release");
    expect(releaseJob).toContain("github.ref_type == 'tag'");
    expect(releaseJob).toContain("!inputs.dry_run");
  });

  it("手工触发默认只检查不发布", () => {
    expect(workflow).toMatch(/dry_run:[\s\S]*?default: true/);
  });

  it("标签触发是发版的唯一自动入口", () => {
    expect(workflow).toMatch(/push:\s*\n\s*tags:\s*\n\s*- "v\*"/);
  });

  it("截取片段不会跨过 job 边界：publish 片段里不含 release job 的条件", () => {
    expect(jobBlock("publish")).not.toContain("action-gh-release");
  });
});

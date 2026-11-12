/**
 * 包管理器矩阵作业的判据。
 *
 * 这条作业的价值是长期护栏：脚手架产物在四家包管理器下都要装得起来、编译得过、
 * 打得出包。作业装的是 registry 上已发布的包（产物层），因此它不覆盖仓内尚未
 * 发布的改动——判据只钉作业的形状与纪律。
 *
 * 钉住的是几件容易回归的事：矩阵必须覆盖四家、某一家坏了不许放过（不许
 * `continue-on-error` / `|| true`）、以及步骤必须落在产物目录（写错目录会让
 * 「装依赖」这一步在仓根跑，测的就不是产物了）。
 *
 * 断言用文本截取而不是引 YAML 解析器：工作流是少量固定结构，加一个依赖不划算，
 * 而且重点是「那一行在不在」，不是 YAML 语义。断言必须限定在 job 内。
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

/** 取 `\n  <job>:` 到下一个同级 job 之前的片段 */
function jobBlock(job: string): string {
  const marker = `\n  ${job}:`;
  const start = workflow.indexOf(marker);
  expect(start, `工作流里找不到 job「${job}」`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + marker.length);
  const next = rest.search(/\n  [a-z][\w-]*:/);
  return next === -1 ? rest : rest.slice(0, next);
}

/** 在给定 job 片段里取某个步骤块，到该 job 内下一个步骤之前 */
function stepBlock(job: string, name: string): string {
  const body = jobBlock(job);
  const start = body.indexOf(`- name: ${name}`);
  expect(start, `job「${job}」里找不到步骤「${name}」`).toBeGreaterThan(-1);
  const rest = body.slice(start);
  const next = rest.indexOf("\n      - name:", 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("包管理器矩阵作业", () => {
  it("矩阵覆盖四家包管理器", () => {
    const job = jobBlock("package-manager-matrix");
    expect(job).toContain("manager: [npm, pnpm, yarn, bun]");
  });

  it("某一家坏了不许放过：作业不许吞错", () => {
    const job = jobBlock("package-manager-matrix");
    expect(job).not.toContain("continue-on-error");
    expect(job).not.toContain("|| true");
  });

  it("四家各自失败都要看得见，不许因一家先挂而掐掉其余", () => {
    expect(jobBlock("package-manager-matrix")).toContain("fail-fast: false");
  });

  it("装依赖、编译与打包三步都落在产物目录", () => {
    for (const name of ["安装依赖", "编译故事", "打包"]) {
      expect(stepBlock("package-manager-matrix", name)).toContain(
        "working-directory: ${{ runner.temp }}/work/demo",
      );
    }
  });

  it("三步都走矩阵里的那一家，而不是写死某一家", () => {
    for (const name of ["安装依赖", "编译故事", "打包"]) {
      const block = stepBlock("package-manager-matrix", name);
      expect(block).toContain("${{ matrix.manager }}");
    }
  });

  it("脚手架从本地打包安装，不从 registry 装生成器", () => {
    const pack = stepBlock("package-manager-matrix", "打出脚手架包");
    expect(pack).toContain("npm pack ./packages/create");
    expect(pack).toContain("--pack-destination");
    const install = stepBlock("package-manager-matrix", "装上脚手架");
    expect(install).toContain("npm install -g");
    expect(install).toContain("lingfan-engine-create-*.tgz");
  });

  it("npm 这一格放行构建产物的安装脚本", () => {
    const prepare = stepBlock("package-manager-matrix", "准备包管理器");
    expect(prepare).toContain("npm_config_allow_scripts=esbuild");
  });

  it("门禁作业与矩阵作业互不影响：门禁仍只跑静态判据", () => {
    expect(jobBlock("gates")).not.toContain("package-manager-matrix");
    expect(jobBlock("package-manager-matrix")).not.toContain("pnpm test:unit");
  });
});

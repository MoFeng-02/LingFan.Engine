import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MANIFEST_FILE,
  SEED_BYTES,
  SEED_FILE,
  parseArgs,
  planSteps,
  runEncryptPublish,
  verifyAndroidAssets,
  verifyPackOutput,
} from "../../scripts/release/encrypt-publish.mjs";

const temps: string[] = [];
function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lfen-encrypt-publish-"));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 造一个形态完整的加密发布根（清单加密态 + 32 字节 seed + 密文内容 + assets 映射）。 */
function makeEncryptedPack(root: string): void {
  fs.mkdirSync(path.join(root, "Stories"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist", "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(root, MANIFEST_FILE),
    JSON.stringify({
      resourceEncryption: true,
      frontend: { assets: ["dist/assets/index.js"] },
    }),
  );
  fs.writeFileSync(path.join(root, SEED_FILE), Buffer.alloc(SEED_BYTES, 7));
  fs.writeFileSync(
    path.join(root, "Stories", "a.story.enc"),
    Buffer.concat([Buffer.from("LFEN2"), Buffer.alloc(32, 1)]),
  );
  fs.writeFileSync(
    path.join(root, "dist", "assets", "index.js.enc"),
    Buffer.concat([Buffer.from("LFEN2"), Buffer.alloc(32, 2)]),
  );
}

describe("encrypt-publish · parseArgs（命令行契约）", () => {
  it("缺省：明文默认拒绝、不跳构建、非干跑", () => {
    const options = parseArgs([]);
    expect(options.allowPlaintext).toBe(false);
    expect(options.skipBuild).toBe(false);
    expect(options.dryRun).toBe(false);
  });
  it("目录参数与开关逐一生效", () => {
    const options = parseArgs([
      "--input",
      "in",
      "--output",
      "out",
      "--dist",
      "d",
      "--android-assets",
      "a",
      "--allow-plaintext",
      "--skip-build",
      "--dry-run",
    ]);
    expect(options.input).toBe("in");
    expect(options.output).toBe("out");
    expect(options.dist).toBe("d");
    expect(options.androidAssets).toBe("a");
    expect(options.allowPlaintext).toBe(true);
    expect(options.skipBuild).toBe(true);
    expect(options.dryRun).toBe(true);
  });
  it("未知参数与缺值参数一律拒绝（fail-closed）", () => {
    expect(() => parseArgs(["--bogus"])).toThrow();
    expect(() => parseArgs(["--output"])).toThrow();
  });
});

describe("encrypt-publish · planSteps（管线顺序即契约）", () => {
  it("前端产物 → 加密打包 → 产物校验，校验是强制末环", () => {
    const steps = planSteps(parseArgs([]));
    expect(steps.map((s) => s.label)).toEqual([
      "前端产物",
      "加密打包",
      "产物校验",
    ]);
    expect(steps[0].command).toBe("pnpm");
    expect(steps[1].command).toBe("cargo");
    expect(steps[1].args).toContain("lfenpack");
    expect(steps[1].args).toContain("--strict");
    expect(steps.at(-1)?.label).toBe("产物校验");
  });
  it("--skip-build 只去掉前端构建，加密与校验仍在且顺序不变", () => {
    const steps = planSteps(parseArgs(["--skip-build"]));
    expect(steps.map((s) => s.label)).toEqual(["加密打包", "产物校验"]);
  });
});

describe("encrypt-publish · verifyPackOutput（产物形态）", () => {
  it("完整加密包通过（资源加密态 + seed 形态 + assets 形态）", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    const result = verifyPackOutput(root);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });
  it("旧格式魔数（LFEN）同样认可（兼容读口径一致）", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.writeFileSync(
      path.join(root, "Stories", "a.story.enc"),
      Buffer.concat([Buffer.from("LFEN"), Buffer.alloc(32, 3)]),
    );
    expect(verifyPackOutput(root).ok).toBe(true);
  });
  it("明文内容文件默认拒绝；显式 --allow-plaintext 降级为警告", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.writeFileSync(path.join(root, "Stories", "b.story"), "plaintext");
    const denied = verifyPackOutput(root);
    expect(denied.ok).toBe(false);
    expect(denied.problems.join()).toContain("明文内容文件");
    const allowed = verifyPackOutput(root, { allowPlaintext: true });
    expect(allowed.ok).toBe(true);
    expect(allowed.warnings.join()).toContain("明文内容文件");
  });
  it("清单未处于加密态默认拒绝", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.writeFileSync(
      path.join(root, MANIFEST_FILE),
      JSON.stringify({ resourceEncryption: false }),
    );
    const result = verifyPackOutput(root);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain("加密态");
  });
  it("seed 缺失默认拒绝；长度不符恒拒绝（密钥引导形态）", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.rmSync(path.join(root, SEED_FILE));
    expect(verifyPackOutput(root).ok).toBe(false);
    fs.writeFileSync(path.join(root, SEED_FILE), Buffer.alloc(SEED_BYTES - 1));
    const bad = verifyPackOutput(root, { allowPlaintext: true });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join()).toContain("形态不符");
  });
  it(".enc 但魔数不符恒拒绝（坏密文不是明文豁免能覆盖的）", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.writeFileSync(path.join(root, "Stories", "a.story.enc"), "not-cipher");
    const result = verifyPackOutput(root, { allowPlaintext: true });
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain("魔数不符");
  });
  it("清单声明的 assets 缺对应密文拒绝（assets 形态）", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.rmSync(path.join(root, "dist", "assets", "index.js.enc"));
    const result = verifyPackOutput(root);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain("assets 缺对应密文");
  });
  it("发布根不存在 / 清单缺失 / 清单坏 JSON 一律拒绝", () => {
    expect(verifyPackOutput(path.join(tmpRoot(), "missing")).ok).toBe(false);
    const root = tmpRoot();
    expect(verifyPackOutput(root).ok).toBe(false);
    fs.writeFileSync(path.join(root, MANIFEST_FILE), "{bad");
    expect(verifyPackOutput(root).problems.join()).toContain("合法 JSON");
  });
});

describe("encrypt-publish · verifyAndroidAssets（生成 assets 纳入检查）", () => {
  it("assets 未生成则跳过（不拦非 Android 发布）", () => {
    const result = verifyAndroidAssets(tmpRoot());
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });
  it("已生成的明文 Resources 默认拒绝（防明文随 APK 带走）", () => {
    const assets = tmpRoot();
    const resources = path.join(assets, "Resources");
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(
      path.join(resources, MANIFEST_FILE),
      JSON.stringify({ resourceEncryption: false }),
    );
    fs.writeFileSync(path.join(resources, "plain.story"), "plaintext");
    const result = verifyAndroidAssets(assets);
    expect(result.ok).toBe(false);
    expect(result.problems.join()).toContain("Android assets");
  });
  it("已生成的加密 Resources 通过", () => {
    const assets = tmpRoot();
    makeEncryptedPack(path.join(assets, "Resources"));
    const result = verifyAndroidAssets(assets);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });
});

describe("encrypt-publish · runEncryptPublish（串联与默认拒明文）", () => {
  function recorder() {
    const calls: Array<{ command: string; args: string[] }> = [];
    return {
      calls,
      exec: (command: string, args: string[]) => {
        calls.push({ command, args });
      },
    };
  }
  it("全链按序执行：前端构建 → 加密打包 → 产物校验（注入执行器，不真跑构建）", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    const { calls, exec } = recorder();
    const logs: string[] = [];
    const code = runEncryptPublish(
      ["--output", root, "--android-assets", path.join(root, "no-assets")],
      { log: (m) => logs.push(m), exec },
    );
    expect(code).toBe(0);
    expect(calls.map((c) => c.command)).toEqual(["pnpm", "cargo"]);
    expect(logs.join("\n")).toContain("产物校验");
  });
  it("明文产物默认拒绝：管线末环校验失败即非零退出", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.writeFileSync(path.join(root, "Stories", "plain.story"), "plaintext");
    const { exec } = recorder();
    const logs: string[] = [];
    const code = runEncryptPublish(
      ["--output", root, "--android-assets", path.join(root, "no-assets")],
      { log: (m) => logs.push(m), exec },
    );
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("校验失败");
    expect(logs.join("\n")).toContain("--allow-plaintext");
  });
  it("显式 --allow-plaintext 放行明文并留警告痕", () => {
    const root = tmpRoot();
    makeEncryptedPack(root);
    fs.writeFileSync(path.join(root, "Stories", "plain.story"), "plaintext");
    const { exec } = recorder();
    const logs: string[] = [];
    const code = runEncryptPublish(
      [
        "--output",
        root,
        "--android-assets",
        path.join(root, "no-assets"),
        "--allow-plaintext",
      ],
      { log: (m) => logs.push(m), exec },
    );
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("警告");
  });
  it("--dry-run 只打印计划不执行；步骤失败与坏参数非零退出", () => {
    const { calls, exec } = recorder();
    const logs: string[] = [];
    expect(
      runEncryptPublish(["--dry-run"], { log: (m) => logs.push(m), exec }),
    ).toBe(0);
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("计划");
    const failing = runEncryptPublish([], {
      log: () => {},
      exec: () => {
        throw new Error("boom");
      },
    });
    expect(failing).toBe(1);
    expect(runEncryptPublish(["--bogus"], { log: () => {} })).toBe(1);
  });
});

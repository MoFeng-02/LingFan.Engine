/**
 * 脚手架桌面壳的安全姿态：CSP、槽位校验、明文降格声明、Isolation 裁定。
 *
 * 为什么测这个：桌面壳是「交付安全」的第一道门面，配置与文案若 silent 背离
 * （CSP 放空、槽位无上限、把明文存档说成加密），使用者会带着错误预期交付。
 * 这里把四件事钉成机器可验的判据；槽位校验的行为证明在 Rust 侧 cargo 测试，
 * 本文件验的是「配置与声明真的在场、口径一致」。
 *
 * 用 `?raw` 读文本而不碰 fs：`tests/template` 属前端域，禁 Node 导入。
 */
import { describe, expect, it } from "vitest";
import tauriConf from "../../template/v1/overlays/tauri/src-tauri/tauri.conf.json?raw";
import shellReadme from "../../template/v1/overlays/tauri/README.md?raw";
import saveRs from "../../template/v1/overlays/tauri/src-tauri/src/save.rs?raw";
import savesZh from "../../docs/src/content/docs/concepts/saves.md?raw";
import encryptionZh from "../../docs/src/content/docs/concepts/encryption.md?raw";
import packagingZh from "../../docs/src/content/docs/guides/packaging.md?raw";
import savesEn from "../../docs/src/content/docs/en/concepts/saves.md?raw";

const conf = JSON.parse(tauriConf) as {
  app?: { security?: { csp?: string | null } };
};
const csp = conf.app?.security?.csp;

/** 把 CSP 串拆成「指令名 → 源列表」，便于逐条断言而不是整串模糊匹配 */
function directives(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(" ");
    const name = space === -1 ? trimmed : trimmed.slice(0, space);
    const value = space === -1 ? "" : trimmed.slice(space + 1).trim();
    map.set(name, value);
  }
  return map;
}

describe("桌面壳 CSP 策略（csp-policy-present）", () => {
  it("csp 非 null，是一条非空策略串", () => {
    expect(typeof csp).toBe("string");
    expect((csp ?? "").length).toBeGreaterThan(0);
  });

  it("最小权限指令齐全：default/script/connect/img/object/base", () => {
    const d = directives(csp ?? "");
    expect(d.get("default-src")).toBe("'self'");
    expect(d.get("script-src")).toBe("'self'");
    expect(d.get("object-src")).toBe("'none'");
    expect(d.get("base-uri")).toBe("'self'");
    expect(d.get("connect-src") ?? "").toContain("ipc:");
    expect(d.get("connect-src") ?? "").toContain("http://ipc.localhost");
    expect(d.get("img-src") ?? "").toContain("'self'");
  });

  it("不开 unsafe-eval；脚本源不放 unsafe-inline（产物是预编译外部脚本）", () => {
    expect(csp ?? "").not.toContain("unsafe-eval");
    const d = directives(csp ?? "");
    expect(d.get("script-src") ?? "").not.toContain("unsafe-inline");
  });
});

describe("脚手架槽位校验 fail-closed（slot-validation-fail-closed）", () => {
  it("save.rs 声明 1–64 长度上限并真的据此拒绝", () => {
    expect(saveRs).toContain("MAX_SLOT_LEN");
    expect(saveRs).toMatch(/const\s+MAX_SLOT_LEN\s*:\s*usize\s*=\s*64/);
    expect(saveRs).toMatch(/slot\.len\(\)\s*>\s*MAX_SLOT_LEN/);
  });

  it("错误是结构化 {code,detail}（serde tag=code），不是裸字符串", () => {
    expect(saveRs).toContain('#[serde(tag = "code", content = "detail")]');
    expect(saveRs).toContain("enum SaveError");
    expect(saveRs).toContain('rename = "invalid-slot"');
  });
});

describe("明文降格声明在场（docs-declaration-exists / scaffold-shell-plaintext-posture）", () => {
  it("模板 README 明示明文参考实现 + 自带 Rust 加密层 + 全栈指引", () => {
    expect(shellReadme).toContain("明文");
    expect(shellReadme).toContain("参考实现");
    expect(shellReadme).toContain("Rust 加密层");
    expect(shellReadme).toContain("K1–K8");
    expect(shellReadme).toContain("playground");
  });

  it("save.rs 头注带安全口径（明文参考实现，交付需自带安全层）", () => {
    expect(saveRs).toContain("明文");
    expect(saveRs).toContain("参考实现");
  });

  it("docs 中文三页都补了降格声明", () => {
    for (const page of [savesZh, encryptionZh, packagingZh]) {
      expect(page).toContain("明文参考实现");
      expect(page).toContain("Rust 加密层");
      expect(page).toContain("playground");
    }
  });

  it("docs 英文镜像（saves）同步降格声明", () => {
    expect(savesEn).toContain("plaintext");
    expect(savesEn).toContain("reference implementation");
    expect(savesEn).toContain("Rust encryption layer");
    expect(savesEn).toContain("playground");
  });

  it("声明不得宣称脚手架存档已加密（诚实检查）", () => {
    expect(shellReadme).not.toMatch(/存档已加密|存档默认加密|存档是安全的/);
    expect(savesZh).toContain("不加密");
  });
});

describe("Isolation 模式裁定文档化（isolation-decision-documented）", () => {
  it("README 记录了 Isolation 评估结论（不启用）与理由", () => {
    expect(shellReadme).toContain("Isolation");
    expect(shellReadme).toContain("不启用");
  });
});

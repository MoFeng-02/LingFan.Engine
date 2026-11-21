/**
 * 加密发布管线：一条命令串起「前端产物 → 加密资源包 → 产物校验」。
 *
 * 用法：
 *   node scripts/release/encrypt-publish.mjs [选项]
 *     --input <目录>        明文工程资源根（缺省 apps/playground/Resources）
 *     --output <目录>       加密发布根（缺省 build/release-resources）
 *     --dist <目录>         前端产物目录（缺省 apps/playground/dist）
 *     --android-assets <目录>  Android 生成 assets 根（缺省 playground src-tauri/gen/android/app/src/main/assets）
 *     --allow-plaintext     显式允许明文产物（缺省拒绝：明文发布必须显式知情）
 *     --skip-build          跳过前端构建，直接用已有 dist
 *     --dry-run             只打印步骤计划，不执行
 *
 * 为什么串联：三步手工（构建前端 / lfenpack 加密 / 人眼核对产物）容易漏掉最后一步，
 * 明文包就这样发出去了。这里把校验做成管线的强制末环——默认拒绝任何明文内容文件，
 * 只有显式 `--allow-plaintext` 才放行（并降级为警告留痕）。
 *
 * 边界：本脚本不做平台打包（tauri build 属发布动作，由使用者在真机环境执行）；
 * Android 的 assets 目录若已生成，同样按加密形态校验，防止明文资源随 APK 带走。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 密钥引导文件名（与 Rust 侧 DEK_SEED 同一约定）。 */
export const SEED_FILE = "__key__.seed";
/** seed 形态：裸 32 字节 DEK（与 Rust 侧 DEK_LEN 同一约定）。 */
export const SEED_BYTES = 32;
/** 工程清单文件名（恒明文：运行期形态判定的先决读取）。 */
export const MANIFEST_FILE = "project.json";
/** 密文魔数：新格式 5 字节 / 旧格式 4 字节（与 Rust 侧 MAGIC 同一约定）。 */
const MAGIC_V2 = Buffer.from("LFEN2");
const MAGIC_V1 = Buffer.from("LFEN");
/** 包内允许明文的豁免集：工程元数据 + 密钥引导，其余内容必须密文。 */
const PLAINTEXT_EXEMPT = new Set([MANIFEST_FILE, SEED_FILE]);

/** 从命令行读出这次发布怎么跑。 */
export function parseArgs(argv) {
  const options = {
    input: "apps/playground/Resources",
    output: "build/release-resources",
    dist: "apps/playground/dist",
    androidAssets: "apps/playground/src-tauri/gen/android/app/src/main/assets",
    allowPlaintext: false,
    skipBuild: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-plaintext") {
      options.allowPlaintext = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (
      arg === "--input" ||
      arg === "--output" ||
      arg === "--dist" ||
      arg === "--android-assets"
    ) {
      const value = argv[(index += 1)];
      if (value === undefined) {
        throw new Error(`${arg} 需要一个目录参数`);
      }
      const key = {
        "--input": "input",
        "--output": "output",
        "--dist": "dist",
        "--android-assets": "androidAssets",
      }[arg];
      options[key] = value;
    } else {
      throw new Error(`无法识别的参数：${arg}`);
    }
  }
  return options;
}

/**
 * 管线的步骤计划（顺序即契约：前端产物 → 加密打包 → 产物校验）。
 * 校验是强制末环，不作为可选步骤暴露——漏校验等于允许明文默认放行。
 */
export function planSteps(options) {
  const steps = [];
  if (!options.skipBuild) {
    steps.push({
      label: "前端产物",
      command: "pnpm",
      args: ["--filter", "@lingfan-engine/playground", "build"],
    });
  }
  steps.push({
    label: "加密打包",
    command: "cargo",
    args: [
      "run",
      "--manifest-path",
      "apps/playground/src-tauri/Cargo.toml",
      "--bin",
      "lfenpack",
      "--",
      options.input,
      options.output,
      "--force",
      "--strict",
      "--dist",
      options.dist,
    ],
  });
  steps.push({ label: "产物校验", command: null, args: [] });
  return steps;
}

/** 递归列出目录下所有文件的相对路径（POSIX 分隔）。 */
function walkFiles(root) {
  const out = [];
  const visit = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  visit(root, "");
  return out;
}

/** 密文形态判定：读文件头比对魔数（不解密，只验形态）。 */
function hasCipherMagic(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const head = Buffer.alloc(5);
    const n = fs.readSync(fd, head, 0, 5, 0);
    return (
      (n >= 5 && head.subarray(0, 5).equals(MAGIC_V2)) ||
      (n >= 4 && head.subarray(0, 4).equals(MAGIC_V1))
    );
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 校验加密发布根的产物形态。返回 `{ ok, problems, warnings }`：
 * - 清单必须处于加密态（resourceEncryption=true）；
 * - seed 必须在场且恰为 32 字节（密钥引导形态）；
 * - 内容文件必须 `.enc` 且带密文魔数；豁免集（清单/seed）之外出现明文即问题；
 * - 清单声明的 frontend.assets 必须逐一有对应密文（assets 形态）。
 * `allowPlaintext=true` 时明文类问题降级为警告（显式知情的明文发布）。
 */
export function verifyPackOutput(outputDir, { allowPlaintext = false } = {}) {
  const problems = [];
  const warnings = [];
  const report = (message) => {
    if (allowPlaintext) {
      warnings.push(message);
    } else {
      problems.push(message);
    }
  };
  if (!fs.existsSync(outputDir) || !fs.statSync(outputDir).isDirectory()) {
    return { ok: false, problems: [`发布根不存在：${outputDir}`], warnings };
  }
  const manifestPath = path.join(outputDir, MANIFEST_FILE);
  let manifest;
  if (!fs.existsSync(manifestPath)) {
    problems.push(`缺 ${MANIFEST_FILE}（工程清单）`);
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      problems.push(`${MANIFEST_FILE} 不是合法 JSON`);
    }
  }
  if (manifest !== undefined && manifest.resourceEncryption !== true) {
    report("清单未处于加密态（resourceEncryption 应为 true）");
  }
  const seedPath = path.join(outputDir, SEED_FILE);
  if (!fs.existsSync(seedPath)) {
    report(`缺 ${SEED_FILE}（密钥引导）`);
  } else if (fs.statSync(seedPath).size !== SEED_BYTES) {
    problems.push(`${SEED_FILE} 形态不符（须 ${SEED_BYTES} 字节）`);
  }
  for (const rel of walkFiles(outputDir)) {
    if (PLAINTEXT_EXEMPT.has(rel)) {
      continue;
    }
    const full = path.join(outputDir, rel);
    if (!rel.endsWith(".enc")) {
      report(`明文内容文件：${rel}`);
      continue;
    }
    if (!hasCipherMagic(full)) {
      problems.push(`密文魔数不符：${rel}`);
    }
  }
  const assets = manifest?.frontend?.assets;
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      // 清单里的 assets 逻辑路径自带 dist/ 前缀（与打包器写入同一口径）
      const enc = path.join(outputDir, `${asset}.enc`);
      if (!fs.existsSync(enc)) {
        problems.push(`清单声明的 assets 缺对应密文：${asset}.enc`);
      }
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

/**
 * Android 生成 assets 的加密形态校验：assets/Resources 若已生成，
 * 按发布根同一口径检查（防明文资源随 APK 带走）；未生成则跳过。
 */
export function verifyAndroidAssets(
  assetsDir,
  { allowPlaintext = false } = {},
) {
  const resources = path.join(assetsDir, "Resources");
  if (!fs.existsSync(resources)) {
    return { ok: true, problems: [], warnings: [], skipped: true };
  }
  const result = verifyPackOutput(resources, { allowPlaintext });
  return {
    ok: result.ok,
    problems: result.problems.map((p) => `Android assets：${p}`),
    warnings: result.warnings.map((w) => `Android assets：${w}`),
    skipped: false,
  };
}

/**
 * 执行一次加密发布管线。返回退出码：0 成功，1 失败。
 * `exec` 可注入（测试以记录器断言步骤顺序，不真跑构建）。
 */
export function runEncryptPublish(argv, { log = () => {}, exec } = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    log(String(error instanceof Error ? error.message : error));
    return 1;
  }
  const run =
    exec ??
    ((command, args) => {
      execFileSync(command, args, {
        stdio: "inherit",
        shell: process.platform === "win32",
      });
    });
  const steps = planSteps(options);
  if (options.dryRun) {
    for (const step of steps) {
      log(
        `计划：${step.label}${step.command ? `（${step.command} ${step.args.join(" ")}）` : ""}`,
      );
    }
    log("--dry-run：到此为止，未执行");
    return 0;
  }
  for (const step of steps) {
    log(`${step.label}…`);
    if (step.command !== null) {
      try {
        run(step.command, step.args);
      } catch {
        log(`步骤失败：${step.label}`);
        return 1;
      }
      continue;
    }
    // 强制末环：产物校验（发布根 + Android assets 若已生成）
    const pack = verifyPackOutput(options.output, {
      allowPlaintext: options.allowPlaintext,
    });
    const android = verifyAndroidAssets(options.androidAssets, {
      allowPlaintext: options.allowPlaintext,
    });
    for (const warning of [...pack.warnings, ...android.warnings]) {
      log(`警告（显式允许明文）：${warning}`);
    }
    const problems = [...pack.problems, ...android.problems];
    if (problems.length > 0) {
      for (const problem of problems) {
        log(`校验失败：${problem}`);
      }
      log("默认拒绝明文发布；确需明文请显式加 --allow-plaintext");
      return 1;
    }
  }
  log(`加密发布管线完成：${options.output}（平台打包由使用者在真机环境执行）`);
  return 0;
}

// 直接调用时执行；被 import（测试）时不触发。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = runEncryptPublish(process.argv.slice(2), {
    log: (message) => console.log(message),
  });
}

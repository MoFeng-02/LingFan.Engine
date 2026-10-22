/**
 * 发布前自检：把四个公开包逐个打成 tarball，按**消费者实际拿到的东西**检查，全部合格才允许发布。
 *
 * 为什么必须查 tarball 而不是查仓库里的 package.json：发布链路上有两处会改动元数据，
 * 只看源文件会漏掉——
 *   1. 工作区协议只在 pnpm 打包时才被改写成具体版本范围，`npm pack` 会把它原样带出去；
 *      带出去之后消费方安装直接失败（npm 报不支持的协议），而发布本身是成功的。
 *   2. `files` 决定的实际入包文件清单，只有解包才知道有没有漏带许可副本、误带测试或内部文档。
 *
 * 打包用 pnpm（它会做协议改写），上传用 npm（registry 的凭据、两步验证与来源证明都以 npm CLI 为准）。
 * 本脚本只负责打包与校验，不发任何网络请求，也不改动仓库文件。
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 对外发布的包。私有包（构建期工具与编辑器）不在此列，它们不进 registry。 */
export const PUBLISHED_PACKAGES = [
  "@lingfan-engine/core",
  "@lingfan-engine/adapters",
  "@lingfan-engine/ui",
  "@lingfan-engine/shell",
];

/** 每个包都必须声明的字段。缺失会让 registry 页面、来源追溯或安装行为缺东西。 */
const REQUIRED_FIELDS = [
  "name",
  "version",
  "description",
  "license",
  "repository",
  "homepage",
  "bugs",
  "exports",
  "files",
  "engines",
];

/** 依赖里出现这些协议前缀说明工作区协议没被改写，消费方装不上 */
const WORKSPACE_PROTOCOL = "workspace:";

/** 包内不该出现的文件：测试、内部文档、环境变量、源码外的临时产物 */
const FORBIDDEN_IN_TARBALL = [
  /\.test\.[cm]?[jt]s$/,
  /\.spec\.[cm]?[jt]s$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
];

/** Windows 上 pnpm 是可执行批处理，直接给出文件名即可，不必经 shell 传参 */
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/**
 * 调用 pnpm。
 *
 * Windows 上 pnpm 是 `.cmd`，Node 24 起不允许不带 shell 直接 spawn（报 EINVAL）；
 * 而带 `shell: true` 又配 args 数组会触发 DEP0190。两个坑的公共解法是：
 * 自己把命令拼成一个字符串，只传字符串、不传 args。
 */
function runPnpm(args, options) {
  const quoted = args.map((arg) =>
    /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg,
  );
  const command = `${PNPM} ${quoted.join(" ")}`;
  return execFileSync(command, { ...options, shell: true });
}

function packAll(destination) {
  for (const name of PUBLISHED_PACKAGES) {
    runPnpm(["--filter", name, "pack", "--pack-destination", destination], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
}

/**
 * 解包读数一律以「临时目录 + 文件名」为工作目录传入。
 *
 * 不能直接传绝对路径：Windows 上的 GNU tar 会把 `E:\…` 里的冒号当成远程主机分隔符，
 * 报 "Cannot connect to E: resolve failed"。相对文件名没有这个歧义。
 */
function readTarball(cwd, file, innerPath) {
  return execFileSync("tar", ["-xzOf", file, innerPath], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function listTarball(cwd, file) {
  return execFileSync("tar", ["-tzf", file], {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * 单个包的判据。返回失败清单——空数组即合格。
 *
 * 判据全部落在「消费者能观察到的事实」上：元数据字段、依赖声明、包内文件。
 * 不检查代码风格与测试覆盖率，那是提交门禁的事，发布前重跑没有意义。
 */
export function checkPackage({ name, manifest, entries, repoVersion }) {
  const failures = [];

  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined)
      failures.push(`${name}: 缺少字段 ${field}`);
  }

  if (manifest.private === true) {
    failures.push(`${name}: package.json 标记为 private，registry 拒收`);
  }

  if (manifest.name !== name) {
    failures.push(
      `${name}: 包名不符（实际 ${String(manifest.name)}），发布到错误的 scope`,
    );
  }

  if (manifest.version !== repoVersion) {
    failures.push(
      `${name}: 版本 ${String(manifest.version)} 与仓库声明 ${String(repoVersion)} 不一致`,
    );
  }

  if (manifest.publishConfig?.access !== "public") {
    failures.push(
      `${name}: publishConfig.access 不是 public，作用域包会被拒收`,
    );
  }

  if (
    typeof manifest.repository === "object" &&
    manifest.repository?.url === undefined
  ) {
    failures.push(`${name}: repository.url 缺失，来源追溯不可用`);
  }

  const deps = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const [dep, range] of Object.entries(deps)) {
    if (String(range).includes(WORKSPACE_PROTOCOL)) {
      failures.push(
        `${name}: 依赖 ${dep} 仍是 ${String(range)}，消费方安装会失败`,
      );
    }
  }

  if (!entries.includes("package/LICENSE")) {
    failures.push(`${name}: 包内没有 LICENSE 副本，分发时缺少许可声明`);
  }

  for (const entry of entries) {
    const relative = entry.replace(/^package\//, "");
    for (const pattern of FORBIDDEN_IN_TARBALL) {
      if (pattern.test(relative)) {
        failures.push(`${name}: 包内不应包含 ${relative}`);
        break;
      }
    }
  }

  if (!entries.some((entry) => /^package\/src\/index\.ts$/.test(entry))) {
    failures.push(`${name}: 包内缺少 src/index.ts，exports 指向的入口不存在`);
  }

  return failures;
}

/**
 * 交叉检查：内部依赖的版本范围必须能匹配到本次发布的版本。
 *
 * 逐个包单看都合格，但 `^0.1.1` 指向一个没发布的版本时，消费方装到的仍是旧包——
 * 这类缺陷在单包视角下不可见，只能在包与包之间看。
 */
export function checkCrossPackage({ manifests }) {
  const failures = [];
  for (const [name, manifest] of Object.entries(manifests)) {
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies };
    for (const [dep, range] of Object.entries(deps)) {
      if (!dep.startsWith("@lingfan-engine/")) continue;
      const target = manifests[dep];
      if (target === undefined) {
        failures.push(`${name}: 依赖内部包 ${dep}，但它不在发布清单里`);
        continue;
      }
      const wanted = String(range).replace(/^[\^~>=<\s]+/, "");
      if (!target.version.startsWith(wanted)) {
        failures.push(
          `${name}: 依赖 ${dep}@${String(range)}，但本次发布的是 ${String(target.version)}`,
        );
      }
    }
  }
  return failures;
}

/**
 * 跑完整自检。
 *
 * `keepIn` 给定时把 tarball 留在该目录（发布流程要用它上传），否则打包到系统临时目录并在结束时清掉——
 * 校验是这件事的主体，留一堆 tgz 在仓库里没有意义。
 */
export function runPublishCheck({ keepIn } = {}) {
  const destination = keepIn ?? mkdtempSync(join(tmpdir(), "lingfan-publish-"));
  const cleanup = keepIn === undefined;
  try {
    packAll(destination);
    const tarballs = readdirSync(destination).filter((file) =>
      file.endsWith(".tgz"),
    );
    if (tarballs.length !== PUBLISHED_PACKAGES.length) {
      return {
        failures: [
          `打包数量不符：预期 ${PUBLISHED_PACKAGES.length} 个，实际 ${tarballs.length} 个`,
        ],
        tarballs: [],
        manifests: {},
        destination,
      };
    }

    const failures = [];
    const manifests = {};
    const tarballInfo = [];

    for (const name of PUBLISHED_PACKAGES) {
      const short = name.replace("@lingfan-engine/", "");
      const file = tarballs.find((item) =>
        item.startsWith(`lingfan-engine-${short}-`),
      );
      if (file === undefined) {
        failures.push(`${name}: 未找到打包产物`);
        continue;
      }
      const manifest = JSON.parse(
        readTarball(destination, file, "package/package.json").toString("utf8"),
      );
      const entries = listTarball(destination, file);
      const repoManifest = JSON.parse(
        readFileSync(join(repoRoot, "packages", short, "package.json"), "utf8"),
      );

      manifests[name] = manifest;
      tarballInfo.push({ name, file, size: entries.length });
      failures.push(
        ...checkPackage({
          name,
          manifest,
          entries,
          repoVersion: repoManifest.version,
        }),
      );
    }

    failures.push(...checkCrossPackage({ manifests }));

    return { failures, tarballs: tarballInfo, manifests, destination };
  } finally {
    if (cleanup) rmSync(destination, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  // `--keep <目录>`：把 tarball 留下给发布步骤用。自检与发布跑在同一份产物上，
  // 才能保证「检查通过的」就是「发出去的」。
  const keepIndex = process.argv.indexOf("--keep");
  const keepIn = keepIndex === -1 ? undefined : process.argv[keepIndex + 1];
  const { failures, tarballs, destination } = runPublishCheck({ keepIn });
  console.log("发布前自检（scripts/publish-check.mjs）");
  for (const item of tarballs) {
    console.log(
      `  ${item.name.padEnd(28)} ${String(item.size).padStart(4)} 个文件  ${item.file}`,
    );
  }
  if (keepIn !== undefined) console.log(`\n  打包产物保留在 ${destination}`);
  if (failures.length === 0) {
    console.log("\n  检查结论 · 通过（四个包可直接发布）");
  } else {
    console.log(`\n  检查结论 · 失败 ${failures.length} 项：`);
    for (const failure of failures) console.log(`    ${failure}`);
    process.exitCode = 1;
  }
}

/** 供测试复用的仓库根，避免测试再算一遍路径 */
export const repoRootPath = repoRoot;
/** 供测试核对「文件确实存在」时使用 */
export function packageDirOf(name) {
  return join(repoRoot, "packages", name.replace("@lingfan-engine/", ""));
}
/** 包目录存在性：清单与磁盘不一致时给测试一个明确信号 */
export function publishedPackageDirs() {
  return PUBLISHED_PACKAGES.map(packageDirOf).filter((dir) => existsSync(dir));
}

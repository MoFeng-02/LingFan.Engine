/**
 * 模板副本一致性：`template/v1/**` 与 `packages/create/template/**` 必须是同一份东西。
 *
 * 仓库里存着两棵模板树——一棵给 `apps/playground` 与手改工程用，一棵打进 `create` 骨架。
 * 它们由人工复制维持同步，而不同步的症状极其隐蔽：脚手架新建的工程少了一个宿主字段、
 * 样式表差一条规则，`create` 出来的工程从第一步就是坏的，仓库内部的模板却一切正常。
 *
 * 判据只要求「副本之间逐字节相同」，不要求模板与引擎同批发布——生成期的占位符替换与
 * 版本注入都只发生在**产物**里，两棵树在仓库里都按原样存盘，所以直接比原文，不做归一化。
 *
 * 为什么在测试里主动把副本造出来，而不是只读现成的：`packages/create/template` 是
 * gitignore 的构建产物（`prepack` 时才同步），干净检出里它不存在。只读现成目录的话，
 * 判据会把「还没同步」与「读到 0 个文件」混成同一种状态，缺目录时退化成「零差异通过」。
 * 所以先按发布链同一份脚本同步一次，再比两棵树：既验内容一致，也验同步脚本本身可用。
 * 同步是幂等的，重复跑不产生差异。
 *
 * 二进制（`.png` / `.icns` / `.ico`）也一并比字节：`?raw` 得到的文本是有损解码，
 * 而逐字节比较对文本与二进制一视同仁，不用为扩展名维护白名单。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const TEMPLATE_ROOT = join(REPO_ROOT, "template", "v1");
const PACKAGED_ROOT = join(REPO_ROOT, "packages", "create", "template");
const SYNC_SCRIPT = join(
  REPO_ROOT,
  "packages",
  "create",
  "scripts",
  "copy-template.mjs",
);

/**
 * 只在模板树里存在的路径。
 *
 * `Resources/Saves` 是运行期存档目录：打包脚本按目录名排除它，工程的 gitignore 也忽略它，
 * 所以它只可能出现在模板那一侧。
 */
const EXPECTED_ONLY_IN_TEMPLATE: readonly string[] = [
  "__PROJECT__/Resources/Saves/.gitkeep",
];

/** 递归列出目录下的文件，路径用 `/` 分隔且相对 `root`；目录不存在返回空表 */
function listFiles(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!existsSync(root)) return out;
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out.set(rel, readFileSync(full));
    }
  };
  walk(root, "");
  return out;
}

let skeleton: Map<string, Buffer>;
let packaged: Map<string, Buffer>;

beforeAll(() => {
  // 与发布链同一份脚本：副本缺失时才需要造，已存在则直接比（幂等，重复跑无副作用）
  if (!existsSync(PACKAGED_ROOT)) {
    execFileSync(process.execPath, [SYNC_SCRIPT], { cwd: REPO_ROOT });
  }
  skeleton = listFiles(TEMPLATE_ROOT);
  packaged = listFiles(PACKAGED_ROOT);
});

describe("模板副本一致性", () => {
  it("扫描面非空：两棵树都读到足够多的文件", () => {
    // 目录改名或搬走后，下面的判据会「零差异所以通过」——先钉住扫描面本身
    expect(skeleton.size).toBeGreaterThan(100);
    expect(packaged.size).toBeGreaterThan(100);
  });

  it("两棵树的文件清单一致（除运行期存档目录）", () => {
    const onlyInSkeleton = [...skeleton.keys()]
      .filter((path) => !packaged.has(path))
      .filter((path) => !EXPECTED_ONLY_IN_TEMPLATE.includes(path))
      .sort();
    const onlyInCreate = [...packaged.keys()]
      .filter((path) => !skeleton.has(path))
      .sort();

    expect(
      onlyInCreate,
      `create 侧多出的文件：\n${onlyInCreate.join("\n")}`,
    ).toEqual([]);
    expect(
      onlyInSkeleton,
      `模板侧多出的文件（重新同步一次即可）：\n${onlyInSkeleton.join("\n")}`,
    ).toEqual([]);
  });

  it("同名文件逐字节相同", () => {
    const differing = [...skeleton.keys()]
      .filter((path) => packaged.has(path))
      .filter((path) => !skeleton.get(path)!.equals(packaged.get(path)!))
      .sort();

    expect(
      differing,
      `以下文件两棵树内容不同（改一边必须同步另一边）：\n${differing.join("\n")}`,
    ).toEqual([]);
  });
});

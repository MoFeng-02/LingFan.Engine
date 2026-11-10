/**
 * 模板副本一致性：`template/v1/**` 与 `packages/create/template/**` 必须是同一份东西。
 *
 * 仓库里存着两棵模板树——一棵给 `apps/playground` 与手改工程用，一棵打进 `create` 骨架。
 * 它们由人工复制维持同步，而不同步的症状极其隐蔽：脚手架新建的工程少了一个宿主字段、
 * 样式表差一条规则，`create` 出来的工程从第一步就是坏的，仓库内部的模板却一切正常。
 *
 * 兼容性判据（G4）只要求「副本之间逐字节相同」，不要求模板与引擎同批发布——
 * 生成期的占位符替换与版本注入都只发生在**产物**里，两棵树在仓库里都按原样存盘，
 * 所以这里直接比原文，不做归一化。
 *
 * 二进制（`.png` / `.icns` / `.ico`）也一并比：`?raw` 得到的文本是有损解码，
 * 但只要两边逐字节相同，解码结果必然相同；不同则几乎必然不同，足以逮出「换了图标只改一边」。
 */
import { describe, expect, it } from "vitest";

/** 模板树根（值 = 原文；键 = 绝对化后的路径，下面统一裁成树内相对路径） */
const TEMPLATE_TREE = import.meta.glob("../../template/v1/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const CREATE_TREE = import.meta.glob("../../packages/create/template/**/*", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/**
 * 只在其中一棵树里存在的路径。
 *
 * `Resources/Saves` 是运行期存档目录：模板包与新建工程都不带它（打包脚本按目录名排除，
 * 工程的 gitignore 也忽略它），所以它只可能出现在被跑过的那棵树上。
 */
const EXPECTED_ONLY_IN_TEMPLATE: readonly string[] = [
  "__PROJECT__/Resources/Saves/.gitkeep",
];

/** 把 glob 的键裁成树内相对路径（`__PROJECT__/src/main.ts` 这种） */
function relativeTo(
  tree: Record<string, string>,
  prefix: string,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, text] of Object.entries(tree)) {
    const at = path.indexOf(prefix);
    if (at < 0) continue;
    out.set(path.slice(at + prefix.length), text);
  }
  return out;
}

const skeleton = relativeTo(TEMPLATE_TREE, "/template/v1/");
const packaged = relativeTo(CREATE_TREE, "/packages/create/template/");

/** 两棵树的路径并集，排序后便于稳定报差异 */
function allPaths(): string[] {
  return [...new Set([...skeleton.keys(), ...packaged.keys()])].sort();
}

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
      `模板侧多出的文件（复制过去即可）：\n${onlyInSkeleton.join("\n")}`,
    ).toEqual([]);
  });

  it("同名文件逐字节相同", () => {
    const differing = allPaths().filter((path) => {
      const left = skeleton.get(path);
      const right = packaged.get(path);
      return left !== undefined && right !== undefined && left !== right;
    });

    expect(
      differing,
      `以下文件两棵树内容不同（改一边必须同步另一边）：\n${differing.join("\n")}`,
    ).toEqual([]);
  });
});

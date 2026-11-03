/**
 * 模板与引擎兼容判定的判据。
 *
 * 这条判据存在的理由是一次真实的事故形态：模板用了新引擎才有的 API，
 * 生成器却把旧版本钉进清单，直到使用者 `pnpm dev` 才炸在一条与模板无关的报错上。
 * 所以这里要钉的是「什么时候该拦住」与「什么时候必须放行」两侧——
 * 离线时拦住生成是不可接受的，那等于把生成器变成联网才能用的东西。
 */
import { describe, expect, it } from "vitest";
import {
  checkEngineCompatibility,
  ENGINE_SCOPE,
} from "../../packages/create/src/registry/compat.ts";

/** 造一张 registry 解析结果表 */
function resolvedOf(
  table: Readonly<Record<string, string>>,
): Map<string, string> {
  return new Map(Object.entries(table));
}

describe("checkEngineCompatibility", () => {
  it("引擎版本达到要求时放行", () => {
    expect(
      checkEngineCompatibility(
        "0.3.0",
        resolvedOf({ [`${ENGINE_SCOPE}core`]: "0.3.0" }),
      ),
    ).toBeUndefined();
  });

  it("引擎版本高于要求时放行", () => {
    expect(
      checkEngineCompatibility(
        "0.3.0",
        resolvedOf({
          [`${ENGINE_SCOPE}core`]: "0.4.1",
          [`${ENGINE_SCOPE}ui`]: "0.5.0",
        }),
      ),
    ).toBeUndefined();
  });

  it("引擎版本低于要求时拦住，并点名差在哪", () => {
    const problem = checkEngineCompatibility(
      "0.3.0",
      resolvedOf({ [`${ENGINE_SCOPE}core`]: "0.2.0" }),
    );
    expect(problem).toContain("0.3.0");
    expect(problem).toContain("@lingfan-engine/core@0.2.0");
  });

  it("多个包不达标时全部点名", () => {
    const problem = checkEngineCompatibility(
      "0.3.0",
      resolvedOf({
        [`${ENGINE_SCOPE}core`]: "0.2.0",
        [`${ENGINE_SCOPE}ui`]: "0.1.9",
      }),
    );
    expect(problem).toContain("@lingfan-engine/core@0.2.0");
    expect(problem).toContain("@lingfan-engine/ui@0.1.9");
  });

  it("非引擎包不参与判定", () => {
    // vue / vite 之类的外部依赖版本再低也与模板要求的引擎版本无关，
    // 把它们算进来会让判定永远失败（vite 的 8.x 永远小于 0.3.0 之外的任何数？不，
    // 但 react 的 18.x 显然不该跟引擎版本比）。
    expect(
      checkEngineCompatibility(
        "0.3.0",
        resolvedOf({
          vue: "3.5.0",
          react: "18.2.0",
          vite: "8.0.0",
          [`${ENGINE_SCOPE}core`]: "0.3.0",
        }),
      ),
    ).toBeUndefined();
  });

  it("一个版本都没查到（离线）时放行", () => {
    // 离线是正常场景：模板记录的区间就是将要安装的东西，
    // 那时「能不能装」由 npm 决定，不该由生成器猜。
    expect(checkEngineCompatibility("0.3.0", new Map())).toBeUndefined();
  });

  it("查到的表里没有引擎包时放行", () => {
    expect(
      checkEngineCompatibility("0.3.0", resolvedOf({ vue: "3.5.0" })),
    ).toBeUndefined();
  });

  it("版本号无法解析时拦下并说明，而不是静默放行", () => {
    const problem = checkEngineCompatibility(
      "0.3.0",
      resolvedOf({ [`${ENGINE_SCOPE}core`]: "latest" }),
    );
    expect(problem).toContain("无法与 0.3.0 比较");
  });

  it("预发布版低于同号正式版：要求 0.3.0 时 0.3.0-rc.1 不达标", () => {
    expect(
      checkEngineCompatibility(
        "0.3.0",
        resolvedOf({ [`${ENGINE_SCOPE}core`]: "0.3.0-rc.1" }),
      ),
    ).toContain("@lingfan-engine/core@0.3.0-rc.1");
  });
});

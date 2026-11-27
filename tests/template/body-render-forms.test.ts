/**
 * 列身体的三种宿主形态：源码级互锁（与 mount-render-forms 同一套判据思路）。
 *
 * 行为判据在 `stage-body.test.ts`（原生，可真跑）与 `packages/ui` 的 body 域纯投影
 * 测试里。本文件守的是**接线形态**必须一致的那几条——这些错编译得过、跑起来也
 * 「像在工作」，症状是某个形态的身体永不出现且零诊断：
 *
 * - 身体表必须来自生成物：`scenes` 只经 `src/scenes.ts` 一处进入宿主；
 * - 框架形态交 `onBody`（父子关系归框架），不传 `bodyContainer`；
 * - 框架页面把 `BodyHost` 渲染进 `#body`；
 * - 框架层必须摘掉骨架的原生身体工厂（`create.remove`），否则同目录两份 hello
 *   会让扫描器选错文件；
 * - React 层与 Vue 层能力对等：Vue 有的身体接线 React 必须有（防「有 #body 节点、
 *   有句柄、没接线」的空头形态——编译过、跑起来也像在工作，症状是身体永不出现且零诊断）。
 */
import { describe, expect, it } from "vitest";
import nativeEntry from "../../template/v1/__PROJECT__/src/main.ts?raw";
import nativeScenes from "../../template/v1/__PROJECT__/src/scenes.ts?raw";
import vueEntry from "../../template/v1/overlays/vue/src/main.ts?raw";
import vueApp from "../../template/v1/overlays/vue/src/App.vue?raw";
import vueBodyHost from "../../template/v1/overlays/vue/src/BodyHost.vue?raw";
import vuePatch from "../../template/v1/overlays/vue/package.patch.json?raw";
import reactEntry from "../../template/v1/overlays/react/src/main.tsx?raw";
import reactApp from "../../template/v1/overlays/react/src/App.tsx?raw";
import reactBodyHost from "../../template/v1/overlays/react/src/BodyHost.tsx?raw";
import reactPatch from "../../template/v1/overlays/react/package.patch.json?raw";
import reactSceneRegister from "../../template/v1/overlays/react/src/gen/scene_register.g.ts?raw";
import vueSceneRegister from "../../template/v1/overlays/vue/src/gen/scene_register.g.ts?raw";

/** 剥注释：判据只看代码骨架 */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DECLARATIVE = [
  {
    id: "Vue",
    entry: vueEntry,
    app: vueApp,
    host: vueBodyHost,
    patch: vuePatch,
  },
  {
    id: "React",
    entry: reactEntry,
    app: reactApp,
    host: reactBodyHost,
    patch: reactPatch,
  },
] as const;

describe("列身体：身体表来自生成物（body-table-from-generated）", () => {
  it("生成物只经 `src/scenes.ts` 一处进入宿主", () => {
    expect(code(nativeScenes)).toContain('from "./gen/scene_register.g"');
    for (const form of DECLARATIVE) {
      expect(
        code(form.host),
        `${form.id} BodyHost 绕过 ./scenes`,
      ).not.toContain("scene_register.g");
      expect(
        code(form.host),
        `${form.id} BodyHost 没从 ./scenes 取值`,
      ).toContain('from "./scenes"');
    }
  });

  it("两个框架层的生成物都指向本层组件文件（不是骨架的 .ts 工厂）", () => {
    expect(vueSceneRegister).toContain("../scenes/hello/hello.vue");
    expect(reactSceneRegister).toContain("../scenes/hello/hello.tsx");
  });
});

describe("列身体：框架形态把落法留给自己（body-framework-owns-render）", () => {
  it("Vue / React 组合根交 onBody 而不是 bodyContainer", () => {
    for (const form of DECLARATIVE) {
      const text = code(form.entry);
      expect(text, `${form.id} 组合根没接管身体落法`).toContain("onBody");
      expect(text, `${form.id} 组合根取了 bodyStore`).toContain("bodyStore");
      expect(
        text,
        `${form.id} 组合根还传了 bodyContainer，会与框架的渲染树打架`,
      ).not.toContain("bodyContainer");
    }
  });

  it("原生组合根交 bodyContainer + scenesTable（渲染器自己算差量）", () => {
    const text = code(nativeEntry);
    expect(text).toContain("bodyContainer");
    expect(text).toContain("scenesTable");
    expect(text).not.toContain("onBody");
  });

  it("框架页面的 #body 由 BodyHost 渲染（react-body-host-wired）", () => {
    expect(code(vueApp)).toMatch(/<div id="body">\s*<BodyHost \/>/);
    expect(code(reactApp)).toMatch(/<div id="body">\s*<BodyHost \/>/);
  });

  it("BodyHost 只订阅 store，不自己订阅引擎（退订只有一份实现）", () => {
    for (const form of DECLARATIVE) {
      const text = code(form.host);
      expect(text, `${form.id} BodyHost 自己订阅了引擎`).not.toContain(
        "onStateChanged",
      );
      expect(text, `${form.id} BodyHost 没用 store 订阅`).toMatch(
        /bodyStore\.(subscribe|snapshot)/,
      );
    }
  });
});

describe("列身体：框架层摘掉骨架工厂（body-overlay-removes-native）", () => {
  it("Vue / React 的 create.remove 都点名骨架的 hello.ts", () => {
    for (const form of DECLARATIVE) {
      const patch = JSON.parse(form.patch) as {
        create?: { remove?: string[] };
      };
      expect(
        patch.create?.remove ?? [],
        `${form.id} 层没摘骨架身体工厂——同目录两份 hello 会让扫描选错文件`,
      ).toContain("src/scenes/hello/hello.ts");
    }
  });
});

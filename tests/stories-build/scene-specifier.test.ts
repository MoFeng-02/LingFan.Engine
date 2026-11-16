/**
 * 场景说明符判定：`src/scenes/<名>/<名>.<扩展名>` 这一条形状。
 *
 * 与 UI 通道共用一套判定实现（组件通道），这里锚的是「换成场景说法之后仍然对」：
 * 落位、层级、文件名 = 目录名三条都合，才认一个场景；`.vue` / `.tsx` 越界即
 * fail-closed；`.ts` 是特例（它同时是故事源的扩展名），位置不合规就只是普通模块。
 *
 * 另一条是**通道归属**：`ui/…` 说明符不许场景通道认领，`scenes/…` 也不许 UI 认领。
 * 两条通道各判一遍同一条说明符，写错一处就会得到两条措辞不同的诊断——这里用
 * 「只有一条通道报错」把归属钉死。
 */
import { describe, expect, it } from "vitest";
import {
  createComponentChannel,
  type ComponentChannel,
} from "../../packages/stories-build/src/compiler/story-compiler/graph/scan/component-specifier.ts";
import { createSceneChannel } from "../../packages/stories-build/src/compiler/story-compiler/graph/scan/scene-specifier.ts";
import { createUiChannel } from "../../packages/stories-build/src/compiler/story-compiler/graph/scan/ui-specifier.ts";
import {
  SCENE_REGISTER_BASENAME,
  SCENE_DIR_NAME,
} from "../../packages/stories-build/src/compiler/story-compiler/graph/core.ts";

/** 源根固定成 `Stories.src`：判定只关心相对位置，不需要真实工程 */
const SOURCES = "/proj/src/Stories.src";

/**
 * 裸场景通道：只判形状，不管归属。
 *
 * 正式的 `createSceneChannel` 会把「两条通道都不认」的越界让给 UI 通道收口（免得
 * 一处写错报两遍），那样就看不到形状判定的原始结果。形状这一层用裸通道锚。
 */
const rawScene: ComponentChannel = createComponentChannel(
  SOURCES,
  SCENE_DIR_NAME,
  SCENE_REGISTER_BASENAME,
);

/** 从 `chapter1/start.ts` 发起导入时的判定 */
function classifyFrom(
  channel: { classify(fromRel: string, spec: string): { kind: string } },
  spec: string,
  fromRel = "chapter1/start.ts",
): string {
  return channel.classify(fromRel, spec).kind;
}

const shaped = (spec: string): string => classifyFrom(rawScene, spec);

describe("场景说明符 · 形状判定", () => {
  it("合上 scenes/<名>/<名>.<扩展名>：给出名字与相对 src/ 的位置", () => {
    expect(
      rawScene.classify(
        "chapter1/start.ts",
        "../../scenes/kitchen/kitchen.vue",
      ),
    ).toEqual({
      kind: "component",
      name: "kitchen",
      relPath: "scenes/kitchen/kitchen.vue",
    });
    // 三种组件扩展名一视同仁
    expect(shaped("../../scenes/kitchen/kitchen.tsx")).toBe("component");
    expect(shaped("../../scenes/kitchen/kitchen.ts")).toBe("component");
  });

  it("场景名允许 `-`：目录名与文件名同时成立即可", () => {
    expect(
      rawScene.classify(
        "chapter1/start.ts",
        "../../scenes/room-kitchen/room-kitchen.vue",
      ),
    ).toEqual({
      kind: "component",
      name: "room-kitchen",
      relPath: "scenes/room-kitchen/room-kitchen.vue",
    });
  });

  it("层级必须恰两层：多一层少一层都不是场景", () => {
    // 多一层（scenes/kitchen/deep/kitchen.vue）
    expect(shaped("../../scenes/kitchen/deep/kitchen.vue")).toBe("outside");
    // 少一层（scenes/kitchen.vue）
    expect(shaped("../../scenes/kitchen.vue")).toBe("outside");
  });

  it("文件名必须等于目录名：不一致 fail-closed", () => {
    expect(shaped("../../scenes/kitchen/other.vue")).toBe("file-name");
  });

  it("越出 src/ 是越界（场景沙箱是源根的上一级）", () => {
    expect(shaped("../../../x/x.vue")).toBe("outside");
  });

  it("落在源树内部不是场景：scenes/ 前缀指的是源根内部那层", () => {
    // 从 chapter1/ 往下写 `scenes/…` 折出来是 `Stories.src/chapter1/scenes/…`
    expect(shaped("./scenes/a/a.vue")).toBe("outside");
  });

  it("`.ts` 位置不合规 ⇒ 交回模块图（它是故事源自己的扩展名）", () => {
    // `.tsx` 越界报错，而同一位置的 `.ts` 必须是普通模块——否则故事源互相导入就全红
    expect(shaped("../../lib/helper.ts")).toBe("not-component");
    expect(shaped("../../lib/helper.tsx")).toBe("outside");
  });

  it("非组件扩展名不归场景管", () => {
    expect(shaped("../../scenes/kitchen/kitchen.svg")).toBe("not-component");
    expect(shaped("../../lib/cast.ts")).toBe("not-component");
  });

  it("名字前缀相同但不是同一个目录：不当成场景", () => {
    // `scenesx/` 不是 `scenes/`
    expect(shaped("../../scenesx/a/a.vue")).toBe("outside");
  });
});

describe("场景说明符 · 注册表形状", () => {
  it("生成物目录下那一个文件算注册表，别处同名文件交回模块图", () => {
    expect(shaped("../../gen/scene_register.g")).toBe("register");
    // 显式带 .ts 是同一个文件
    expect(shaped("../../gen/scene_register.g.ts")).toBe("register");
    // 别处的同名文件只是恰好同名
    expect(shaped("./scene_register.g")).toBe("not-component");
  });
});

describe("通道归属：一条说明符只由一条通道处置", () => {
  const ui = createUiChannel(SOURCES);
  const scene = createSceneChannel(SOURCES);

  it("ui/ 说明符归 UI，场景通道交回", () => {
    const spec = "../../ui/hub/hub.vue";
    expect(classifyFrom(ui, spec)).toBe("ui");
    expect(classifyFrom(scene, spec)).toBe("not-scene");
  });

  it("scenes/ 说明符归场景，UI 通道交回", () => {
    const spec = "../../scenes/kitchen/kitchen.vue";
    expect(classifyFrom(scene, spec)).toBe("scene");
    expect(classifyFrom(ui, spec)).toBe("not-ui");
  });

  it("两条通道都不认的越界只报一次（由 UI 收口）", () => {
    // 越出 src/ 且落在两个组件目录之外：UI 报越界，场景交回
    const spec = "../../../outside/a.vue";
    expect(classifyFrom(ui, spec)).toBe("outside");
    expect(classifyFrom(scene, spec)).toBe("not-scene");
  });

  it("名字前缀相同但不是同一个目录：UI 侧同样不当成邻居", () => {
    // `uix/` 不是 `ui/`：UI 通道不认识它（越界由它收口）
    expect(classifyFrom(ui, "../../uix/a/a.vue")).toBe("outside");
  });

  it("落入邻居目录的错名字交回邻居判：`ui/` 下的错场景不报场景诊断", () => {
    // 场景通道看到 ui/ 就交回，即使那条说明符本身写得不对
    expect(classifyFrom(scene, "../../ui/hub/wrong.vue")).toBe("not-scene");
    // 反过来同理
    expect(classifyFrom(ui, "../../scenes/kitchen/wrong.vue")).toBe("not-ui");
  });
});

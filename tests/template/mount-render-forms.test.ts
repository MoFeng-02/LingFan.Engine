/**
 * UI 挂载的三种宿主形态：源码级互锁。
 *
 * 这三条形态的**行为**判据在 `mount-render-native.test.ts`（原生，可真跑）与
 * `packages/ui/src/mount/` 的纯投影测试（三形态共用）里。本文件守的是它们
 * **接线形态**必须一致的那几条——这些错编译得过、跑起来也「像在工作」：
 *
 * - 组件表必须来自生成物：`uis` 只经 `src/mounts.ts` 一处进入宿主，没有第二张手写名单。
 *   手写名单在「加了 UI 却忘了登记」时只表现成运行期不出现，而磁盘事实不会漏。
 * - 不许 `import.meta.glob`：那会把 `src/ui/` 下的文件全部静态拉进包（删了 UI 忘删
 *   文件它就还在），并把模板宿主绑死到某个构建工具上。
 * - 隐藏 = 不渲染：列表本身就是可见集合，没有 `display:none` 那条分支。
 *
 * 判据只看剥掉注释后的代码骨架：注释里写「不要 glob」不算违规，写了才算。
 */
import { describe, expect, it } from "vitest";
import nativeHtml from "../../template/v1/__PROJECT__/index.html?raw";
import nativeEntry from "../../template/v1/__PROJECT__/src/main.ts?raw";
import nativeMounts from "../../template/v1/__PROJECT__/src/mounts.ts?raw";
import nativeTable from "../../template/v1/__PROJECT__/src/gen/ui_register.g.ts?raw";
import vueHost from "../../template/v1/overlays/vue/src/UiHost.vue?raw";
import vueApp from "../../template/v1/overlays/vue/src/App.vue?raw";
import vueEntry from "../../template/v1/overlays/vue/src/main.ts?raw";
import reactHost from "../../template/v1/overlays/react/src/UiHost.tsx?raw";
import reactApp from "../../template/v1/overlays/react/src/App.tsx?raw";
import reactEntry from "../../template/v1/overlays/react/src/main.tsx?raw";
import wiring from "../../template/v1/__PROJECT__/src/host/engine-wiring.ts?raw";

/** 剥注释：判据只看代码骨架（HTML 注释、JS 块注释与行注释） */
function code(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * 三形态各自「谁渲染挂载层」的落点。
 *
 * `host` 是真正把名字铺成节点/组件的那个文件；`view` 是页面结构（原生形态没有视图文件，
 * 页面结构在骨架的 index.html 里）。
 */
const FORMS = [
  {
    id: "原生",
    host: nativeMounts,
    entry: nativeEntry,
    view: nativeHtml,
  },
  {
    id: "Vue",
    host: vueHost,
    entry: vueEntry,
    view: vueApp,
  },
  {
    id: "React",
    host: reactHost,
    entry: reactEntry,
    view: reactApp,
  },
] as const;

/** 真正在铺组件的两份（原生形态的表由渲染器消费，不在 mounts.ts 里铺） */
const DECLARATIVE = [FORMS[1], FORMS[2]] as const;

describe("UI 挂载：组件表来自生成物，不是手写名单", () => {
  it("生成物只经 `src/mounts.ts` 一处进入宿主", () => {
    expect(code(nativeMounts)).toContain('from "./gen/ui_register.g"');
    // 除 `mounts.ts` 自己之外，任何组合根或挂载层都不许直接引生成物
    const others = [...FORMS.map((form) => form.entry), vueHost, reactHost];
    for (const source of others) {
      expect(code(source), "有文件绕过 ./mounts 直接引了生成物").not.toContain(
        "ui_register.g",
      );
    }
  });

  it("三形态的接线都从 `./mounts` 取表", () => {
    // 原生：组合根把表交给宿主；框架：挂载层组件自己订阅 store 并读表
    expect(code(nativeEntry)).toContain('from "./mounts"');
    for (const form of DECLARATIVE) {
      expect(
        code(form.host),
        `${form.id} 挂载层没从 ./mounts 取 uis`,
      ).toContain('from "./mounts"');
      expect(code(form.host), `${form.id} 挂载层没用到 uis`).toContain("uis");
    }
  });

  it("挂载层没有手写注册表形态（不出现 register / PageFactory / glob）", () => {
    for (const form of FORMS) {
      const text = code(form.host);
      expect(text, `${form.id} 形态出现了 import.meta.glob`).not.toContain(
        "import.meta.glob",
      );
      // 上一批的形态：把「名字 → 组件」做成需要显式登记的表
      expect(text, `${form.id} 形态出现了 register(`).not.toContain(
        "register(",
      );
      expect(text, `${form.id} 形态出现了 PageRegistry`).not.toContain(
        "PageRegistry",
      );
      expect(text, `${form.id} 形态出现了 PageFactory`).not.toContain(
        "PageFactory",
      );
    }
    // 组合根也不许用 glob 拼表
    for (const form of FORMS) {
      expect(
        code(form.entry),
        `${form.id} 组合根出现了 import.meta.glob`,
      ).not.toContain("import.meta.glob");
    }
  });

  it("生成物表的键就是目录名（宿主不需要再归一）", () => {
    const keys = [...nativeTable.matchAll(/^\s*"([\w-]+)":\s*\w+,$/gm)].map(
      (m) => m[1]!,
    );
    for (const key of keys) {
      expect(key, `生成物里的名字 ${key} 不是合法短标识符`).toMatch(
        /^[a-z][a-z0-9_-]{0,31}$/,
      );
    }
  });
});

describe("UI 挂载：隐藏即不渲染", () => {
  it("Vue 形态按可见集合 v-for，没有 display:none 分支", () => {
    const text = code(vueHost);
    // 列表必须就是 `selectMounts` 的结果：换成 `Object.keys(uis)` 会把表里所有 UI
    // 都挂上（可见集合失去意义），而那仍是一句合法的 v-for
    expect(text).toMatch(/items\s*=\s*computed\(\(\)\s*=>\s*selectMounts\(/);
    expect(text).toContain('v-for="item in items"');
    // 隐藏靠「不在列表里」，不是靠样式藏起来
    expect(text).not.toContain("display");
    expect(text).not.toContain("v-show");
  });

  it("React 形态按可见集合 map，没有 display:none 分支", () => {
    const text = code(reactHost);
    expect(text).toMatch(/items\s*=\s*useMemo\(\(\)\s*=>\s*selectMounts\(/);
    expect(text).toContain("items.map");
    expect(text).not.toContain("display");
    // 不可见的不进列表，也就不进渲染树；`hidden` 属性是另一条路，同样不许
    expect(text).not.toContain("hidden:");
  });

  it("三形态的挂载层容器是同一个节点 id（同一份页面结构契约）", () => {
    for (const form of FORMS) {
      expect(
        code(form.view),
        `${form.id} 形态的页面结构里没有 #mounts`,
      ).toContain('id="mounts"');
    }
  });
});

describe("UI 挂载：框架形态把落法留给自己", () => {
  it("Vue / React 组合根交 onMounts 而不是 mountsContainer（父子关系归框架）", () => {
    for (const form of DECLARATIVE) {
      const text = code(form.entry);
      expect(text, `${form.id} 组合根没接管落法`).toContain("onMounts");
      expect(
        text,
        `${form.id} 组合根还传了 mountsContainer，会与框架的渲染树打架`,
      ).not.toContain("mountsContainer");
    }
  });

  it("原生组合根交 mountsContainer + mountsTable（渲染器自己算差量）", () => {
    const text = code(nativeEntry);
    expect(text).toContain("mountsContainer");
    expect(text).toContain("mountsTable");
    expect(text).not.toContain("onMounts");
  });

  it("框架形态的挂载层被视图组件渲染进 #mounts", () => {
    expect(code(vueApp)).toMatch(/<div id="mounts">\s*<UiHost \/>/);
    expect(code(reactApp)).toMatch(/<div id="mounts">\s*<UiHost \/>/);
  });

  it("接线层首帧主动喂一次（订阅不回放历史，引擎可能先写过）", () => {
    // 只订阅不喂首帧，会让「启动前就 mount 过的 UI」在三形态上一致地不出现——
    // 这种错三形态一起犯，反而不会被「三形态对比」发现
    const text = code(wiring);
    expect(text).toMatch(/onMounts\(engine\.get\(SYS\.mounts\)\)/);
    expect(text).toMatch(/if \(key === SYS\.mounts\)/);
  });
});

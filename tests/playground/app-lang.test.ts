/**
 * 参考宿主语言选择装配（apps/playground/src/host/assets/app-lang）：
 * 内部走 shell 门面、对外保留 Vue ref 显示面并增 t()/bindLang()。
 *
 * 锁三件事：
 * - 切语言即时生效：changeLang 落定后显示态回读引擎实况，t() 随当前语言给译文；
 * - 引擎重启换实例：bindLang 重绑订阅（旧实例退订、新实例接管），显示态同步新引擎；
 * - 可用列表降级语义不变：扫描失败 = 空列表 = 选择器不出现（与门面缺省列表不同）。
 *
 * 引擎替身按契约手写（未命中回原文、供给失败保持原语言、语言键出站），
 * 不复制引擎实现——契约行为由引擎侧测试锁住，这里测「把能力接对」。
 */
import { SYS, type I18nPort, type StoryEngine } from "@lingfan-engine/core";
import { describe, expect, it } from "vitest";
import { createAppLang } from "../../apps/playground/src/host/assets/app-lang";

type Listener = (change: {
  key: string;
  value: unknown;
  scope: string;
}) => void;

/** 契约引擎替身：语言键 + 各语言译文表；setLanguage 失败保持原语言不抛错 */
function fakeEngine(overlayFor: (lang: string) => Map<string, string> | null) {
  const listeners: Listener[] = [];
  const fake = {
    lang: "",
    overlay: null as Map<string, string> | null,
    listenerCount: () => listeners.length,
    get(key: string): unknown {
      return key === SYS.currentLanguage ? fake.lang : undefined;
    },
    translate(text: string): string {
      if (text === "" || fake.overlay === null) return text;
      return fake.overlay.get(text) ?? text;
    },
    async setLanguage(lang: string): Promise<void> {
      if (lang === "") {
        fake.overlay = null;
      } else {
        const loaded = overlayFor(lang);
        if (loaded === null) return; // fail-closed：保持原语言
        fake.overlay = loaded;
      }
      fake.lang = lang;
      for (const l of [...listeners]) {
        l({ key: SYS.currentLanguage, value: lang, scope: "global" });
      }
    },
    onStateChanged(listener: Listener): () => void {
      listeners.push(listener);
      return () => {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
  return fake;
}

/** 替身 → 引擎句柄（装配只见契约；替身只实现本装配消费的四条能力） */
const asEngine = (fake: ReturnType<typeof fakeEngine>): StoryEngine =>
  fake as unknown as StoryEngine;

const enOverlay = new Map([
  ["历史", "History"],
  ["重新开始", "Restart"],
]);

/** 让 listLanguages 的异步 then 落定 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("语言切换即时生效", () => {
  it("changeLang 落定后显示态与 t() 同步给译文", async () => {
    const engine = fakeEngine(() => enOverlay);
    const lang = createAppLang({
      props: {},
      getEngine: () => asEngine(engine),
    });
    lang.bindLang();
    expect(lang.currentLang.value).toBe("");
    expect(lang.t("历史")).toBe("历史");
    await lang.changeLang("en");
    expect(lang.currentLang.value).toBe("en");
    expect(lang.t("历史")).toBe("History");
    expect(lang.t("未收录的句子")).toBe("未收录的句子");
  });

  it("引擎侧语言变化经订阅同步显示态（不经 changeLang 也生效）", async () => {
    const engine = fakeEngine(() => enOverlay);
    const lang = createAppLang({
      props: {},
      getEngine: () => asEngine(engine),
    });
    lang.bindLang();
    await engine.setLanguage("en");
    expect(lang.currentLang.value).toBe("en");
    await engine.setLanguage("");
    expect(lang.currentLang.value).toBe("");
    expect(lang.t("历史")).toBe("历史");
  });

  it("供给失败保持原语言（fail-closed 不抛错，显示态不被改写）", async () => {
    const engine = fakeEngine((l) => (l === "en" ? enOverlay : null));
    const lang = createAppLang({
      props: {},
      getEngine: () => asEngine(engine),
    });
    lang.bindLang();
    await lang.changeLang("en");
    await lang.changeLang("xx"); // 供给失败
    expect(lang.currentLang.value).toBe("en");
    expect(lang.t("历史")).toBe("History");
  });

  it("重启换实例：bindLang 退订旧引擎、接管新引擎并同步现值", async () => {
    const oldEngine = fakeEngine(() => enOverlay);
    let current = oldEngine;
    const lang = createAppLang({
      props: {},
      getEngine: () => asEngine(current),
    });
    lang.bindLang();
    await lang.changeLang("en");
    expect(oldEngine.listenerCount()).toBe(1);
    // restart：新实例语言回默认（app-engine 的复位语义）
    const newEngine = fakeEngine(() => enOverlay);
    current = newEngine;
    lang.bindLang();
    expect(oldEngine.listenerCount()).toBe(0); // 旧订阅已退
    expect(newEngine.listenerCount()).toBe(1);
    expect(lang.currentLang.value).toBe(""); // 同步新引擎实况
    expect(lang.t("历史")).toBe("历史");
    await lang.changeLang("en");
    expect(lang.t("历史")).toBe("History");
    // 同一实例重复 bindLang 不重复订阅
    lang.bindLang();
    expect(newEngine.listenerCount()).toBe(1);
  });
});

describe("可用语言列表：扫描降级语义", () => {
  it("listLanguages 成功 ⇒ 列表补齐（选择器出现）", async () => {
    const port: I18nPort = {
      loadOverlayFiles: async () => [],
      listLanguages: async () => ["zh-CN", "en"],
    };
    const lang = createAppLang({
      props: { i18nPort: port },
      getEngine: () => asEngine(fakeEngine(() => enOverlay)),
    });
    expect(lang.availableLangs.value).toEqual([]); // 异步补齐前为空
    await flush();
    expect(lang.availableLangs.value).toEqual(["zh-CN", "en"]);
  });

  it("listLanguages 失败 ⇒ 空列表保持（选择器不出现，不阻塞切语言）", async () => {
    const port: I18nPort = {
      loadOverlayFiles: async () => [],
      listLanguages: async () => {
        throw new Error("资源根缺失");
      },
    };
    const engine = fakeEngine(() => enOverlay);
    const lang = createAppLang({
      props: { i18nPort: port },
      getEngine: () => asEngine(engine),
    });
    lang.bindLang();
    await flush();
    expect(lang.availableLangs.value).toEqual([]);
    await lang.changeLang("en"); // 列表失败不影响切换
    expect(lang.t("历史")).toBe("History");
  });

  it("未装配供给 ⇒ 列表恒空、t() 原文直出", async () => {
    const lang = createAppLang({
      props: {},
      getEngine: () => asEngine(fakeEngine(() => enOverlay)),
    });
    await flush();
    expect(lang.availableLangs.value).toEqual([]);
    expect(lang.t("历史")).toBe("历史");
  });
});

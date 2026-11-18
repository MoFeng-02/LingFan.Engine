/**
 * 宿主语言门面：查译文 / 切语言 / 订阅 / 语言列表。
 *
 * 引擎替身按契约实现（translate 未命中回原文、setLanguage 失败保持原语言、
 * 幂等不重复出站），不复制引擎实现——门面测的是「把能力接对」，
 * 契约本身的行为由引擎侧测试锁住。
 */
import { SYS } from "@lingfan-engine/core";
import { createHostI18n, type HostI18nEngine } from "@lingfan-engine/shell";
import { describe, expect, it, vi } from "vitest";

type Listener = (change: {
  key: string;
  value: unknown;
  scope: string;
}) => void;

/**
 * 契约引擎替身：持有语言键与各语言译文表，行为只按契约条款走。
 * `overlayFor(lang)` 由用例给定（返回 null = 供给失败）。
 */
function fakeEngine(
  overlayFor: (lang: string) => Map<string, string> | null,
): HostI18nEngine & {
  lang: string;
  overlay: Map<string, string> | null;
  setCalls: string[];
} {
  const listeners: Listener[] = [];
  const fake = {
    lang: "",
    overlay: null as Map<string, string> | null,
    setCalls: [] as string[],
    get(key: string): unknown {
      return key === SYS.currentLanguage ? fake.lang : undefined;
    },
    translate(text: string): string {
      // 契约：空串直返；未装配/未命中回原文
      if (text === "" || fake.overlay === null) return text;
      return fake.overlay.get(text) ?? text;
    },
    async setLanguage(lang: string): Promise<void> {
      fake.setCalls.push(lang);
      // 契约：同语言且表状态一致 ⇒ 幂等，不供给不出站
      const wantsDefault = lang === "";
      const assembled = wantsDefault
        ? fake.overlay === null
        : fake.overlay !== null;
      if (fake.lang === lang && assembled) return;
      if (wantsDefault) {
        fake.overlay = null;
      } else {
        const loaded = overlayFor(lang);
        // 契约：供给失败 fail-closed——保持原语言与译文表不变，不抛错
        if (loaded === null) return;
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

/** 英文表：两句静态文案 + 一句提示条整句（供双轨用例引用同一来源） */
const enOverlay = new Map([
  ["历史", "History"],
  ["确定", "OK"],
]);

describe("门面形状与查表", () => {
  it("初始 currentLang 为空串（默认语言原文直出），t 原样返回", () => {
    const i18n = createHostI18n(fakeEngine(() => enOverlay));
    expect(i18n.currentLang.value).toBe("");
    expect(i18n.t("历史")).toBe("历史");
    expect(i18n.t("")).toBe("");
  });

  it("t 一律经引擎 translate（未命中的句子回原文）", async () => {
    const engine = fakeEngine(() => enOverlay);
    const spy = vi.spyOn(engine, "translate");
    const i18n = createHostI18n(engine);
    await i18n.changeLang("en");
    expect(i18n.t("历史")).toBe("History");
    expect(i18n.t("未收录的句子")).toBe("未收录的句子");
    expect(spy).toHaveBeenCalledWith("历史");
  });

  it("availableLangs 缺省只含默认语言 zh-CN", () => {
    const i18n = createHostI18n(fakeEngine(() => enOverlay));
    expect(i18n.availableLangs).toEqual(["zh-CN"]);
  });
});

describe("切语言与订阅", () => {
  it("changeLang 转发引擎 setLanguage，currentLang 随引擎状态走", async () => {
    const engine = fakeEngine(() => enOverlay);
    const i18n = createHostI18n(engine);
    await i18n.changeLang("en");
    expect(engine.setCalls).toEqual(["en"]);
    expect(i18n.currentLang.value).toBe("en");
    expect(i18n.t("历史")).toBe("History");
    await i18n.changeLang("");
    expect(i18n.currentLang.value).toBe("");
    expect(i18n.t("历史")).toBe("历史");
  });

  it("subscribe 只在语言键变更时回调，订阅者重取 t() 即得新译文", async () => {
    const engine = fakeEngine(() => enOverlay);
    const i18n = createHostI18n(engine);
    const seen: Array<[string, string]> = [];
    i18n.subscribe((lang) => {
      seen.push([lang, i18n.t("历史")]);
    });
    // 非语言键的状态变更不应触发（替身经 onStateChanged 契约广播）
    const unrelated = vi.fn();
    engine.onStateChanged((c) => {
      if (c.key !== SYS.currentLanguage) unrelated();
    });
    await i18n.changeLang("en");
    expect(seen).toEqual([["en", "History"]]);
    expect(unrelated).not.toHaveBeenCalled();
  });

  it("退订后不再收到通知", async () => {
    const i18n = createHostI18n(fakeEngine(() => enOverlay));
    const listener = vi.fn();
    const off = i18n.subscribe(listener);
    await i18n.changeLang("en");
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    await i18n.changeLang("");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("供给失败保持原语言，t() 仍给旧语言译文（fail-closed 由引擎兜底）", async () => {
    const engine = fakeEngine((lang) => (lang === "en" ? enOverlay : null));
    const i18n = createHostI18n(engine);
    await i18n.changeLang("en");
    const listener = vi.fn();
    i18n.subscribe(listener);
    await i18n.changeLang("ja"); // 供给失败
    expect(i18n.currentLang.value).toBe("en");
    expect(i18n.t("历史")).toBe("History");
    expect(listener).not.toHaveBeenCalled();
  });

  it("同语言重复设置为幂等：不重复通知订阅者", async () => {
    const i18n = createHostI18n(fakeEngine(() => enOverlay));
    const listener = vi.fn();
    await i18n.changeLang("en");
    i18n.subscribe(listener);
    await i18n.changeLang("en");
    expect(i18n.currentLang.value).toBe("en");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("语言列表供给", () => {
  it("listLanguages 取回后替换列表，恒含默认语言并去重", async () => {
    const i18nPort = {
      listLanguages: vi.fn(async () => ["en", "ja", "en"]),
    };
    const i18n = createHostI18n(
      fakeEngine(() => enOverlay),
      { i18nPort },
    );
    // 取回前保持缺省列表
    expect(i18n.availableLangs).toEqual(["zh-CN"]);
    await i18nPort.listLanguages.mock.results[0]!.value;
    expect(i18n.availableLangs).toEqual(["zh-CN", "en", "ja"]);
  });

  it("供给已含默认语言时不重复追加", async () => {
    const i18nPort = { listLanguages: async () => ["zh-CN", "en"] };
    const i18n = createHostI18n(
      fakeEngine(() => enOverlay),
      { i18nPort },
    );
    await Promise.resolve();
    expect(i18n.availableLangs).toEqual(["zh-CN", "en"]);
  });

  it("listLanguages 拒绝时保持缺省列表，切语言不受影响", async () => {
    const i18nPort = {
      listLanguages: vi.fn(async () => {
        throw new Error("scan failed");
      }),
    };
    const i18n = createHostI18n(
      fakeEngine(() => enOverlay),
      { i18nPort },
    );
    await i18nPort.listLanguages.mock.results[0]!.value.catch(() => undefined);
    expect(i18n.availableLangs).toEqual(["zh-CN"]);
    await i18n.changeLang("en");
    expect(i18n.t("确定")).toBe("OK");
  });

  it("端口未实现 listLanguages（可选方法缺省）时只显默认语言", () => {
    const i18n = createHostI18n(
      fakeEngine(() => enOverlay),
      { i18nPort: {} },
    );
    expect(i18n.availableLangs).toEqual(["zh-CN"]);
  });
});

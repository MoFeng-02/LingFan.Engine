/**
 * T03-03 编辑器视图侧：提示文案组装 + 「不再提示」偏好持久化（锚点 save-normalization-notice）。
 *
 * 检测归引擎（tests/engine/data/normalization.test.ts）；本文件锁两件事：
 * 1. `describeNormalization` 每行与真实写回行为一一对应（文案一致性是验收条款）；
 * 2. 偏好 = 本机视图偏好（D1）：round trip / 缺失坏值归 false / 存储失败全静默。
 */
import { describe, expect, it } from "vitest";
import { detectWriteNormalization } from "@lingfan/engine";
import {
  describeNormalization,
  NORMALIZATION_NOTICE_PREF_KEY,
  readSkipNormalizationNotice,
  writeSkipNormalizationNotice,
  type KeyValueStorage,
} from "@lingfan/editor";

function memoryStorage(initial?: Record<string, string>): {
  store: KeyValueStorage;
  dump: Map<string, string>;
} {
  const dump = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    store: {
      getItem: (key) => dump.get(key) ?? null,
      setItem: (key, value) => {
        dump.set(key, value);
      },
    },
    dump,
  };
}

describe("describeNormalization（save-normalization-notice）", () => {
  it("每行对应一个真实文件级动作：转换行含目标 JSON 路径、移除行含原因口径", () => {
    const finding = detectWriteNormalization(
      [
        "Stories/title_main.story",
        "Stories/ch1.json",
        "Stories/old.json",
        "Stories/keep.json",
      ],
      ["title_main", "keep"],
    );
    expect(describeNormalization(finding)).toEqual([
      "「Stories/title_main.story」将转换为标准 JSON 列文件「Stories/title_main.json」（内容等价）",
      "「Stories/ch1.json」将从磁盘移除（内容重组为按列命名的单列文件，或已不被当前故事引用）",
      "「Stories/old.json」将从磁盘移除（内容重组为按列命名的单列文件，或已不被当前故事引用）",
    ]);
  });

  it("空 finding → 空文案（界面据此不渲染确认区）", () => {
    expect(
      describeNormalization(detectWriteNormalization(["Stories/a.json"], ["a"])),
    ).toEqual([]);
  });
});

describe("「不再提示」偏好（save-normalization-notice）", () => {
  it("round trip：写 true 读 true、写 false 读 false，键值显式记录", () => {
    const { store, dump } = memoryStorage();
    expect(readSkipNormalizationNotice(store)).toBe(false); // 缺省 = 提示开启
    writeSkipNormalizationNotice(store, true);
    expect(readSkipNormalizationNotice(store)).toBe(true);
    expect(dump.get(NORMALIZATION_NOTICE_PREF_KEY)).toBe("1");
    writeSkipNormalizationNotice(store, false);
    expect(readSkipNormalizationNotice(store)).toBe(false);
    expect(dump.get(NORMALIZATION_NOTICE_PREF_KEY)).toBe("0");
  });

  it("缺失键 / 坏值 → false（fail-open 到可见侧：提示默认开启）", () => {
    const { store } = memoryStorage({
      [NORMALIZATION_NOTICE_PREF_KEY]: "yes",
    });
    expect(readSkipNormalizationNotice(store)).toBe(false);
    expect(readSkipNormalizationNotice(memoryStorage().store)).toBe(false);
  });

  it("undefined storage（浏览器禁站点数据）：读 false、写不抛", () => {
    expect(readSkipNormalizationNotice(undefined)).toBe(false);
    expect(() => writeSkipNormalizationNotice(undefined, true)).not.toThrow();
  });

  it("存储抛错（配额 / 隐私模式）：读 false、写静默不抛", () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readSkipNormalizationNotice(throwing)).toBe(false);
    expect(() => writeSkipNormalizationNotice(throwing, true)).not.toThrow();
  });
});

describe("拟态旅程：打开非规范工程 → 提示 → 不再提示（save-normalization-notice）", () => {
  it("检测 → 文案 → 偏好关闭 → 再开工程提示静默，偏好跨会话持久", () => {
    const { store, dump } = memoryStorage();
    // 第一次打开：磁盘含 .story + 陈旧文件（editor main.ts 的 inspectSave 输入同构）
    const openedPaths = [
      "project.json",
      "Stories/title_main.story",
      "Stories/ch1.json",
      "Stories/keep.json",
    ];
    const finding = detectWriteNormalization(openedPaths, [
      "title_main",
      "keep",
    ]);
    const lines = describeNormalization(finding);
    expect(lines.length).toBe(2); // 转换 + 移除，keep.json 规范不报
    // 作者勾「不再提示」→ 偏好落盘
    writeSkipNormalizationNotice(store, true);
    expect(readSkipNormalizationNotice(store)).toBe(true);
    // 「跨会话」：新 storage 实例从同一持久层读（localStorage 语义）→ 偏好在
    const reopened = memoryStorage({
      [NORMALIZATION_NOTICE_PREF_KEY]:
        dump.get(NORMALIZATION_NOTICE_PREF_KEY) ?? "",
    });
    expect(readSkipNormalizationNotice(reopened.store)).toBe(true);
    // 提示被跳过时保存照常：偏好为 true 时界面不再调 inspectSave（纯 UI 分支），
    // 引擎层保存行为不变量由 tests/editor/save.test.ts 的写回闭环锁定。
  });
});

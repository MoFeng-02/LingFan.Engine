/**
 * 表情差分立绘接入（用户实测回归口径：素材原样接入、不压缩）：
 * - 开场首帧立绘 = Images/角色/灵泛_正面.png，沿用元素 id "lingfan"；
 * - 列内换表情一律 style 改 source（show 无条件追加、不按 id 覆盖，
 *   同 id 再 show 会产生双元素导致 style/animate 全部命中）；
 * - 六张原始素材必须真实存在于资源根（含中文目录名），字节保持原样由作者约束；
 * - 图片路径不进 i18n 键空间（Lang overlay 只收说白文本）。
 */
import { describe, expect, it } from "vitest";
import manifestRaw from "../../apps/playground/Resources/project.json?raw";
import startSource from "../../apps/playground/src/Stories.src/chapter1/start.ts?raw";
import portraitsSource from "../../apps/playground/src/Stories.src/lib/portraits.ts?raw";
import textTaleRaw from "../../apps/playground/Resources/Stories/text_tale.story?raw";
import type { Story, StoryCommand } from "@lingfan-engine/core";
import { assembleProject, parseStoryFile } from "@lingfan-engine/core";

const STORY_MODULES = {
  ...(import.meta.glob("../../apps/playground/Resources/Stories/**/*.story", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>),
  ...(import.meta.glob("../../apps/playground/Resources/Stories/**/*.json", {
    eager: true,
    query: "?raw",
    import: "default",
  }) as Record<string, string>),
};

const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(STORY_MODULES).map(([key, text]) => [
    key.replace("../../apps/playground/Resources/", ""),
    text,
  ]),
);

const PORTRAIT_FILES = [
  "Images/角色/灵泛_正面.png",
  "Images/角色/灵泛_严肃.png",
  "Images/角色/灵泛_娇羞.png",
  "Images/角色/灵泛_愤怒.png",
  "Images/角色/灵泛_手托下巴_疑问.png",
  "Images/角色/灵泛_问号.png",
] as const;

/**
 * 取命令 props 里的 source 字符串。
 * `StoryCommand` 是开放索引签名（`{ op: string; [field: string]: unknown }`），props 是
 * unknown：先收窄到对象再取键——直接访问属性在 vue-tsc 下报 TS2339（vitest 转译会放行，
 * 但类型门禁不放行）。
 */
function propSource(command: StoryCommand): string | undefined {
  const raw = command.props;
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const source = (raw as Record<string, unknown>).source;
  return typeof source === "string" ? source : undefined;
}

function assemble(): Story {
  return assembleProject(
    JSON.parse(manifestRaw),
    new Map(
      Object.entries(FILES).map(([path, text]) => [
        path,
        parseStoryFile(text, path),
      ]),
    ),
  );
}

/** 深度遍历命令树（func/if 的 then/else/body 都要进） */
function walkCommands(
  commands: StoryCommand[],
  visit: (c: StoryCommand) => void,
): void {
  for (const command of commands) {
    visit(command);
    for (const key of ["then", "else", "body"] as const) {
      const nested = command[key];
      if (Array.isArray(nested)) walkCommands(nested, visit);
    }
  }
}

describe("表情差分立绘", () => {
  it("六张原始素材在资源根内真实存在（中文目录名原样寻址）", () => {
    const available = new Set(
      Object.keys(
        import.meta.glob("../../apps/playground/Resources/Images/角色/*", {
          eager: false,
        }),
      ).map((p) => p.replace("../../apps/playground/Resources/", "")),
    );
    for (const file of PORTRAIT_FILES) {
      expect(available, `立绘缺失：${file}`).toContain(file);
    }
  });

  it("共享 lib 是表情路径的唯一声明处：六路径齐全、换图只经 style source", () => {
    for (const file of PORTRAIT_FILES) {
      expect(portraitsSource, `lib 未声明：${file}`).toContain(file);
    }
    // show 只出现在装载函数（hide 幂等 + show）；换表情函数一律 style
    expect(portraitsSource).toMatch(/hide\("lingfan"\)/);
    expect(portraitsSource).toMatch(
      /style\("lingfan", \{ source: "Images\/角色\//,
    );
  });

  it("开场首帧立绘经 portraitNeutral 装载：不再直引旧单张 lingfan.png", () => {
    expect(startSource).toContain("portraitNeutral()");
    expect(startSource).not.toContain('show("Images/lingfan.png"');
    const story = assemble();
    const start = story.columns.find((c) => c.id === "start");
    expect(start).toBeDefined();
    let loaded: StoryCommand | undefined;
    walkCommands(start!.commands ?? [], (c) => {
      if (c.op === "show" && c.target === "Images/角色/灵泛_正面.png")
        loaded = c;
    });
    expect(loaded, "开场须 show 正面立绘").toBeDefined();
    expect(loaded!.id).toBe("lingfan");
  });

  it("换表情命令全部是 style 改 source，且引用的表情真实存在（禁同 id 再 show）", () => {
    const story = assemble();
    const available = new Set<string>(PORTRAIT_FILES);
    let styleCount = 0;
    for (const column of story.columns) {
      const showIds = new Map<string, number>();
      walkCommands(column.commands ?? [], (c) => {
        if (c.op === "show" && typeof c.id === "string") {
          showIds.set(c.id, (showIds.get(c.id) ?? 0) + 1);
        }
        if (c.op !== "style" || c.target !== "lingfan") {
          return;
        }
        const source = propSource(c);
        if (source === undefined) {
          return;
        }
        styleCount += 1;
        expect(
          available,
          `${column.id} 引用了不存在的表情：${source}`,
        ).toContain(source);
      });
      // 同一列内对 lingfan 的 show 至多一次（func 前置 + 列体 call 不重复追加；
      // 多次 show 同 id = 双元素缺陷）
      expect(
        showIds.get("lingfan") ?? 0,
        `${column.id} 对 lingfan 重复 show`,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      styleCount,
      "换表情 style 命令不得为零（断言防空转）",
    ).toBeGreaterThan(4);
  });

  it("text_tale 文本列同样接入：装载 + if/else 两分支换表情", () => {
    const parsed = parseStoryFile(textTaleRaw, "Stories/text_tale.story");
    const column = parsed.columns[0];
    expect(column.id).toBe("text_tale");
    const ops = (column.commands ?? []).map((c) => c.op);
    expect(ops.slice(0, 3)).toEqual(["hide", "show", "style"]);
    expect(textTaleRaw).toContain("灵泛_娇羞.png");
    expect(textTaleRaw).toContain("灵泛_手托下巴_疑问.png");
  });

  it("立绘路径不进 i18n 键空间（Lang overlay 无 Images/ 键）", () => {
    const langModules = import.meta.glob(
      "../../apps/playground/Resources/Lang/**/*.json",
      { eager: true, query: "?raw", import: "default" },
    ) as Record<string, string>;
    for (const [path, raw] of Object.entries(langModules)) {
      const keys = Object.keys(JSON.parse(raw));
      for (const key of keys) {
        expect(key, `${path} 的翻译键混入资源路径`).not.toContain("Images/");
      }
    }
  });
});

/**
 * /demo/ 内嵌真引擎 demo（懒加载模块）——页面引导脚本按需动态 import 本文件，
 * 因此 @lingfan/engine 与 @lingfan/ui 只进异步 chunk，不进任何页面的首屏 JS。
 *
 * 数据流：内置 story DSL 常量 → parseTextStory → assembleProject（真组装器）
 *   → new StoryEngine → createNarrativeOverlay → engine.start()。
 * Apply 语义（镜像编辑器 JsonView/TextModeView 的「镜像 + 手动应用、fail-closed」）：
 * 解析失败只显错、运行时原样保留；成功 = 完整重组装 + 引擎与覆盖层整体重建 + start。
 */
import {
  assembleProject,
  parseStoryFile,
  parseTextStory,
  projectText,
  StoryEngine,
} from "@lingfan/engine";
import type { Story } from "@lingfan/engine";
import { createNarrativeOverlay } from "@lingfan/ui";
import type { NarrativeOverlay } from "@lingfan/ui";
import { DEMO_STORIES } from "./stories";

type Mode = "preview" | "source";
type Tab = "story" | "json" | "ts";

interface DemoState {
  mode: Mode;
  tab: Tab;
  storyKey: string;
  story: Story;
  textDraft: string;
  textDirty: boolean;
  jsonDraft: string;
  jsonDirty: boolean;
  engine: StoryEngine | null;
  overlay: NarrativeOverlay | null;
}

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`demo 页缺少元素 #${id}`);
  return node as T;
}

/** 引擎格式错误的统一取错口：TextFormatError / ProjectAssemblyError 都带 issues */
function issuesOf(error: unknown): string[] {
  if (error !== null && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: unknown }).issues;
    if (Array.isArray(issues)) return issues.map(String);
  }
  return [`解析失败：${String(error)}`];
}

function setStatus(message: string): void {
  must<HTMLParagraphElement>("lf-status").textContent = message;
}

function showErrors(tab: Tab, issues: readonly string[]): void {
  const list = must<HTMLUListElement>(
    tab === "json" ? "lf-err-json" : "lf-err-story",
  );
  list.replaceChildren(
    ...issues.map((issue) => {
      const li = document.createElement("li");
      li.textContent = issue;
      return li;
    }),
  );
}

function clearErrors(tab: Tab): void {
  const id = tab === "json" ? "lf-err-json" : "lf-err-story";
  must<HTMLUListElement>(id).replaceChildren();
}

/** TS 形态页：当前故事的 TS 字面量投影（只读查看） */
function tsDoc(story: Story): string {
  return `// 查看形态 · 不可编辑 —— 当前故事（JSON 文档形态）的 TS 字面量投影\nexport const story = ${JSON.stringify(story, null, 2)};\n`;
}

function syncEditorDom(s: DemoState): void {
  const textArea = must<HTMLTextAreaElement>("lf-text-story");
  const jsonArea = must<HTMLTextAreaElement>("lf-text-json");
  const tsArea = must<HTMLTextAreaElement>("lf-text-ts");
  textArea.value = s.textDraft;
  jsonArea.value = s.jsonDraft;
  tsArea.value = tsDoc(s.story);
  must<HTMLSpanElement>("lf-dirty-story").hidden = !s.textDirty;
  must<HTMLSpanElement>("lf-dirty-json").hidden = !s.jsonDirty;
  (must<HTMLButtonElement>("lf-apply-story") as HTMLButtonElement).disabled =
    !s.textDirty;
  (must<HTMLButtonElement>("lf-apply-json") as HTMLButtonElement).disabled =
    !s.jsonDirty;
}

function refreshEditors(s: DemoState): void {
  if (!s.textDirty) s.textDraft = projectText(s.story).text;
  if (!s.jsonDirty) s.jsonDraft = JSON.stringify(s.story, null, 2);
  syncEditorDom(s);
}

function setMode(s: DemoState, mode: Mode): void {
  s.mode = mode;
  must<HTMLDivElement>("lf-demo-preview").hidden = mode !== "preview";
  must<HTMLDivElement>("lf-demo-source").hidden = mode !== "source";
  must<HTMLButtonElement>("lf-mode-preview").setAttribute(
    "aria-pressed",
    String(mode === "preview"),
  );
  must<HTMLButtonElement>("lf-mode-source").setAttribute(
    "aria-pressed",
    String(mode === "source"),
  );
  if (mode === "preview") {
    const container = must<HTMLDivElement>("lf-demo-preview");
    container.focus({ preventScroll: true });
  }
}

function setTab(s: DemoState, tab: Tab): void {
  s.tab = tab;
  for (const name of ["story", "json", "ts"] as const) {
    must<HTMLDivElement>(`lf-pane-${name}`).hidden = name !== tab;
    must<HTMLButtonElement>(`lf-tab-${name}`).setAttribute(
      "aria-pressed",
      String(name === tab),
    );
  }
}

function updateStoryButtons(s: DemoState): void {
  for (const meta of DEMO_STORIES) {
    must<HTMLButtonElement>(`lf-story-${meta.id}`).setAttribute(
      "aria-pressed",
      String(meta.id === s.storyKey),
    );
  }
}

/**
 * 完整重组装 + 运行时整体重建。任何解析/组装失败都在这里 fail-closed：
 * 只显错，引擎与覆盖层保持上一个可用状态。
 */
function rebuild(s: DemoState, story: Story, errTab: Tab): boolean {
  const manifest = { formatVersion: 1, id: story.id, entry: story.entry };
  const files = new Map<string, unknown>([[`Stories/${story.id}.json`, story]]);
  let assembled: Story;
  try {
    assembled = assembleProject(manifest, files);
  } catch (error) {
    showErrors(errTab, issuesOf(error));
    return false;
  }
  let engine: StoryEngine;
  try {
    engine = new StoryEngine(assembled);
  } catch (error) {
    showErrors(errTab, issuesOf(error));
    return false;
  }
  // 组装与构造都成功，才替换运行时（旧覆盖层 → 旧引擎的释放顺序）。
  s.overlay?.dispose();
  s.engine?.dispose();
  const container = must<HTMLDivElement>("lf-demo-preview");
  const overlay = createNarrativeOverlay({
    container,
    engine,
    textSpeed: 40,
    onError: (message) => setStatus(`引擎消息：${message}`),
  });
  s.engine = engine;
  s.overlay = overlay;
  s.story = story;
  // 范本 overlayDemo.ts:112 同序：覆盖层挂好后引擎才开跑，漏掉则对白恒空。
  engine.start();
  // 对话正文是拉模式：无元素资源回调（范本经 onResolved→sync）时须显式拉一次首帧。
  overlay.sync();
  setMode(s, "preview");
  return true;
}

function applyStory(s: DemoState): void {
  clearErrors("story");
  let merged: Story;
  try {
    const parsed = parseTextStory(s.textDraft, s.story.id);
    merged = {
      ...parsed,
      id: s.story.id,
      ...(s.story.lang !== undefined ? { lang: s.story.lang } : {}),
      entry: parsed.columns.some((column) => column.id === s.story.entry)
        ? s.story.entry
        : parsed.entry,
    };
  } catch (error) {
    showErrors("story", issuesOf(error));
    return;
  }
  if (rebuild(s, merged, "story")) {
    s.textDirty = false;
    s.jsonDirty = false;
    refreshEditors(s);
    setStatus("已应用 · 引擎已按新文本重建");
  }
}

function applyJson(s: DemoState): void {
  clearErrors("json");
  let parsed: Story;
  try {
    parsed = parseStoryFile(s.jsonDraft, `${s.story.id}.json`);
  } catch (error) {
    showErrors("json", issuesOf(error));
    return;
  }
  if (rebuild(s, parsed, "json")) {
    s.textDirty = false;
    s.jsonDirty = false;
    refreshEditors(s);
    setStatus("已应用 · 引擎已按新 JSON 重建");
  }
}

function selectStory(s: DemoState, key: string): void {
  const meta = DEMO_STORIES.find((candidate) => candidate.id === key);
  if (meta === undefined) return;
  let parsed: Story;
  try {
    parsed = parseTextStory(meta.text, meta.id);
  } catch (error) {
    setMode(s, "source");
    setTab(s, "story");
    showErrors("story", issuesOf(error));
    return;
  }
  s.storyKey = meta.id;
  s.textDirty = false;
  s.jsonDirty = false;
  clearErrors("story");
  clearErrors("json");
  updateStoryButtons(s);
  if (rebuild(s, parsed, "story")) {
    refreshEditors(s);
    setStatus(`已载入内置故事：${meta.title} —— ${meta.desc}`);
  }
}

function initDemo(): void {
  if (document.getElementById("lf-demo") === null) return;
  const first = DEMO_STORIES[0];
  if (first === undefined) throw new Error("demo 缺少内置故事");
  const s: DemoState = {
    mode: "preview",
    tab: "story",
    storyKey: first.id,
    story: { formatVersion: 1, id: first.id, entry: first.id, columns: [] },
    textDraft: "",
    textDirty: false,
    jsonDraft: "",
    jsonDirty: false,
    engine: null,
    overlay: null,
  };

  // 键盘输入路由（四步接入范本）：容器获得焦点后，归叙事层消费的按键 → 推进。
  const container = must<HTMLDivElement>("lf-demo-preview");
  container.addEventListener("keydown", (event) => {
    const overlay = s.overlay;
    if (overlay === null || s.mode !== "preview") return;
    if (!overlay.shouldConsumeInput(event)) return;
    event.preventDefault();
    overlay.advance();
  });

  // 鼠标推进：与空格同路径（叙事层的点击转发由宿主实现，demo 直接映射 advance）。
  container.addEventListener("click", () => {
    if (s.overlay === null || s.mode !== "preview") return;
    s.overlay.advance();
  });

  must<HTMLButtonElement>("lf-mode-preview").addEventListener("click", () =>
    setMode(s, "preview"),
  );
  must<HTMLButtonElement>("lf-mode-source").addEventListener("click", () =>
    setMode(s, "source"),
  );
  for (const tab of ["story", "json", "ts"] as const) {
    must<HTMLButtonElement>(`lf-tab-${tab}`).addEventListener("click", () =>
      setTab(s, tab),
    );
  }
  for (const meta of DEMO_STORIES) {
    must<HTMLButtonElement>(`lf-story-${meta.id}`).addEventListener(
      "click",
      () => selectStory(s, meta.id),
    );
  }

  for (const [tab, dirtyKey] of [
    ["story", "textDirty"],
    ["json", "jsonDirty"],
  ] as const) {
    must<HTMLTextAreaElement>(`lf-text-${tab}`).addEventListener(
      "input",
      () => {
        if (tab === "story") {
          s.textDraft = must<HTMLTextAreaElement>("lf-text-story").value;
          s.textDirty = true;
        } else {
          s.jsonDraft = must<HTMLTextAreaElement>("lf-text-json").value;
          s.jsonDirty = true;
        }
        void dirtyKey;
        syncEditorDom(s);
      },
    );
  }
  must<HTMLButtonElement>("lf-regen-story").addEventListener("click", () => {
    s.textDirty = false;
    clearErrors("story");
    refreshEditors(s);
  });
  must<HTMLButtonElement>("lf-regen-json").addEventListener("click", () => {
    s.jsonDirty = false;
    clearErrors("json");
    refreshEditors(s);
  });
  must<HTMLButtonElement>("lf-apply-story").addEventListener("click", () =>
    applyStory(s),
  );
  must<HTMLButtonElement>("lf-apply-json").addEventListener("click", () =>
    applyJson(s),
  );

  selectStory(s, first.id);
}

export { initDemo };

<script setup lang="ts">
/**
 * 诊断面板：按**类型分组 + 同类折叠**的编辑期仪表盘。
 *
 * 为何分组（真问题，非 aesthetics）：同质诊断会淹没异质诊断——常见情形是
 * 数十条 `unused-translation` 把少数真错误（`undefined-variable`）埋掉 ——
 * 根因是**信息架构**（无分组/折叠），调间距/字号救不了「扫读」。
 *
 * 约束：**判据全在 `packages/editor` 的 `diagnostics/grouping.ts`**（纯函数），
 * 本组件只渲染 + 收集折叠意图（与「编辑器 = 纯映射器」一致）。
 */
import { computed, inject, ref } from "vue";
import {
  diagnosticSummaryText,
  filterDiagnosticsBySeverity,
  groupDiagnostics,
  splitDiagnosticMessage,
  summarizeDiagnostics,
  type Diagnostic,
  type SeverityFilter,
} from "@lingfan/editor";

interface EditorApi {
  select(pointer: string | null): void;
  /** 定位揭示：选中 + 切回时间线 + 滚动到目标行 */
  reveal(pointer: string): void;
}
const props = defineProps<{ diagnostics: Diagnostic[] }>();
const api = inject<EditorApi>("editorApi")!;

/** 分组判据在纯函数里（错误组恒在前、error 组不折叠）。
 *  汇总（summary）吃**全量**诊断——它是「严重度普查」，筛选不得改变计数；
 *     分组（groups）吃**筛选后**的子集（徽章可点筛选）。 */
const groups = computed(() =>
  groupDiagnostics(filterDiagnosticsBySeverity(props.diagnostics, severityFilter.value)),
);
const summary = computed(() => summarizeDiagnostics(groupDiagnostics(props.diagnostics)));
const summaryText = computed(() => diagnosticSummaryText(summary.value));

/** 徽章筛选态（null = 全部）。再点同枚 = 取消筛选（toggle 语义） */
const severityFilter = ref<SeverityFilter>(null);
function toggleFilter(severity: "error" | "warning"): void {
  severityFilter.value = severityFilter.value === severity ? null : severity;
}
/** 徽章激活类（diag- 前缀约定：动态类名也走前缀，见 diagnostics-css-isolation 守卫） */
function badgeClass(severity: "error" | "warning"): string {
  return severityFilter.value === severity ? "diag-x-active" : "";
}

/**
 * 用户折叠态：`Set<code>`。
 *
 * **只存「显式展开」的组**（`!<code>`）：
 * 若存「显式折叠」，`toggle` 里就要先读当前态再决定写哪个符号，
 * 而 `collapsedByDefault=true` 的组**首点应该展开**，代码却写了「折叠」标记，
 * 表现为**点了没反应**（过程日志才看得出：`toggle` 明明执行了、
 * `aria-expanded` 却不变 —— 界面正确 ≠ 状态正确）。
 *
 * 只存「显式展开」后逻辑无分支：默认态由判据给，展开过一次就记 `!code`。
 */
const manuallyExpanded = ref<ReadonlySet<string>>(new Set());

function isCollapsed(code: string, byDefault: boolean): boolean {
  return manuallyExpanded.value.has(code) ? false : byDefault;
}

function toggle(code: string): void {
  const next = new Set(manuallyExpanded.value);
  if (next.has(code)) next.delete(code);
  else next.add(code);
  manuallyExpanded.value = next;
}

/**
 * 文案分层：**列表只显示主句**（状态），说明（怎么处置）进 `title` 按需查看。
 *
 * 为什么不用 `message` 直接渲染：原 message 把状态与处置塞进同一句
 * （括号里那段往往写着「本条可忽略」），在窄栏里每条竖排 5~6 行
 * ⇒ **扫读成本极高**。分层是**渲染层**的事，不改
 * `Diagnostic.message` 的既有形状（契约与既有测试全不受影响、无第二份事实源）。
 */
function parts(diagnostic: Diagnostic): { brief: string; detail: string } {
  return splitDiagnosticMessage(diagnostic.message);
}

/**
 * 诊断项 tooltip：**`code` 的归宿**（项内不再渲染它，见模板注释）。
 *
 * 为何带上 code：它在项内被撤掉的唯一理由是**宽度**（与分组头重复 + 吃掉大量横向空间），
 * 但排查问题时「这条属于哪个 code」仍是有用信息 ⇒ 悬停可见，不丢。
 */
function itemTitle(diagnostic: Diagnostic): string {
  const { detail } = parts(diagnostic);
  if (detail !== "") return `[${diagnostic.code}] ${detail}`;
  if (diagnostic.pointer === "") {
    return `[${diagnostic.code}] 全局诊断：不指向具体命令，点击不可定位`;
  }
  return `[${diagnostic.code}] ${diagnostic.pointer}`;
}

/** 诊断带 JSON Pointer——点击定位到命令（空指针 = 全局诊断，不可定位） */
function locate(diagnostic: Diagnostic): void {  // 必须用 `reveal`（不是 `select`）：点诊断必须「看得见」——
  // 目标行可能在视口外/其他视图下，单纯改选中态会被用户感知为"点了没反应"。
  if (diagnostic.pointer !== "") api.reveal(diagnostic.pointer);
}
const keyOf = (d: Diagnostic): string => `${d.code}@${d.pointer}:${d.message}`;
</script>

<template>
  <div class="diag-x-panel">
    <p v-if="props.diagnostics.length === 0" class="diag-x-clean">
      ✓ 无诊断（编辑期校验通过）
    </p>

    <template v-else>
      <!-- 汇总：不逐条罗列（逐条罗列正是淹没的来源）。
           两枚**可点徽章**：error/warning 分级计数，点击筛选、再点取消
           （aria-pressed 表达激活态；零档禁用——没有可筛的东西就不给假按钮）。
           徽章计数吃全量（普查），下方分组吃筛选后子集——两者语义不同。 -->
      <div class="diag-x-summary" :data-errors="summary.errors">
        <span>{{ summaryText }}</span>
        <span class="diag-x-badges" role="group" aria-label="按严重度筛选">
          <button
            class="diag-x-badge diag-x-error"
            :class="badgeClass('error')"
            :aria-pressed="severityFilter === 'error'"
            :disabled="summary.errors === 0"
            :title="severityFilter === 'error' ? '取消筛选（显示全部）' : '只看错误'"
            @click="toggleFilter('error')"
          >
            <span class="diag-x-badge-dot" aria-hidden="true"></span>{{ summary.errors }} 错误
          </button>
          <button
            class="diag-x-badge diag-x-warning"
            :class="badgeClass('warning')"
            :aria-pressed="severityFilter === 'warning'"
            :disabled="summary.warnings === 0"
            :title="severityFilter === 'warning' ? '取消筛选（显示全部）' : '只看警告'"
            @click="toggleFilter('warning')"
          >
            <span class="diag-x-badge-dot" aria-hidden="true"></span>{{ summary.warnings }} 警告
          </button>
        </span>
      </div>

      <section v-for="g in groups" :key="g.code" class="diag-x-group">
        <button
          class="diag-x-group-head"
          :class="[g.severity, { collapsed: isCollapsed(g.code, g.collapsedByDefault) }]"
          :aria-expanded="!isCollapsed(g.code, g.collapsedByDefault)"
          :title="`${g.label}（${g.items.length} 条）`"
          @click="toggle(g.code)"
        >
          <span class="diag-x-caret" aria-hidden="true">{{
            isCollapsed(g.code, g.collapsedByDefault) ? "▸" : "▾"
          }}</span>
          <span class="diag-x-dot" aria-hidden="true"></span>
          <span class="diag-x-label">{{ g.label }}</span>
          <span class="diag-x-count">{{ g.items.length }}</span>
        </button>

        <ul
          v-if="!isCollapsed(g.code, g.collapsedByDefault)"
          class="diag-x-list"
          :aria-label="`${g.label} 明细`"
        >
          <li
            v-for="diagnostic in g.items"
            :key="keyOf(diagnostic)"
            :class="[diagnostic.severity, { global: diagnostic.pointer === '' }]"
            :title="itemTitle(diagnostic)"
            @click="locate(diagnostic)"
          >
            <!-- 项内**不再显示 `code`**：
                 ① 它与**所属分组头完全重复**（分组已按 code 归类，项内再显示一次是零信息）
                 ② 它却占掉大量横向宽度 ⇒ 留给正文的宽度被压缩，长资源路径
                    （如 `Audio/xxx.mp3`）被迫换成 3 行
                 ③ code 移入 tooltip（见 `itemTitle`）——专业排查时仍可悬停看到
                 这不是「文案冗长」，是**宽度被机器标识吃掉**。 -->
            <span class="diag-x-message">{{ parts(diagnostic).brief }}</span>
            <code v-if="diagnostic.pointer !== ''" class="diag-x-pointer">{{
              diagnostic.pointer
            }}</code>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.diag-x-panel {
  flex: 1;
  overflow: auto;
}
.diag-x-clean {
  color: var(--lf-success);
  padding: 8px;
}
/* 汇总条：一眼看清「有多少、其中多少是错误」——不必展开就知道严重程度 */
.diag-x-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  padding: 6px 10px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  border-bottom: 1px solid var(--lf-border-subtle);
  position: sticky;
  top: 0;
  background: var(--lf-surface-raised);
}
.diag-x-summary[data-errors]:not([data-errors="0"]) {
  color: var(--lf-danger);
}
/* 分级徽章：点选筛选，激活态描边 + 淡底；零档禁用 */
.diag-x-badges {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
}
.diag-x-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  font-size: var(--lf-font-xs);
  line-height: 18px;
  color: var(--lf-text-secondary);
  border-radius: var(--lf-radius-sm);
  font-variant-numeric: tabular-nums;
}
.diag-x-badge:disabled {
  opacity: 0.45;
  cursor: default;
}
.diag-x-badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.diag-x-badge.diag-x-error .diag-x-badge-dot {
  background: var(--lf-danger);
}
.diag-x-badge.diag-x-warning .diag-x-badge-dot {
  background: var(--lf-warning);
}
.diag-x-badge.diag-x-active {
  border-color: var(--lf-border-strong);
  background: var(--lf-surface-hover);
  color: var(--lf-text-primary);
}
.diag-x-badge.diag-x-error.diag-x-active {
  color: var(--lf-danger);
}
.diag-x-badge.diag-x-warning.diag-x-active {
  color: var(--lf-warning);
}
.diag-x-group {
  display: flex;
  flex-direction: column;
}
/* 组头：点击面是整行（不是小三角）——窄栏里 8px 三角点不中 */
.diag-x-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  text-align: left;
  border-bottom: 1px solid var(--lf-border-subtle);
  color: var(--lf-text-secondary);
}
.diag-x-group-head:hover {
  background: var(--lf-surface-hover);
}
.diag-x-group-head.collapsed {
  border-bottom-color: transparent;
}
.diag-x-caret {
  width: 10px;
  flex-shrink: 0;
  color: var(--lf-text-hint);
  font-size: var(--lf-font-xs);
}
.diag-x-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.diag-x-count {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.diag-x-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.diag-x-list li {
  display: flex;
  /* 指针/诊断码可能很长（深层逻辑路径）：允许换行到下一行，而不是把 .diag-x-message 挤成 0 宽
     ——后者在窄栏里会表现成**逐字竖排**。 */
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--lf-radius-md);
  cursor: pointer;
}
.diag-x-list li:hover {
  background: var(--lf-surface-hover);
}
/* 全局诊断（pointer 为空）：不可定位 → 不做可点击暗示 */
.diag-x-list .diag-x-list li.diag-x-global {
  cursor: default;
}
.diag-x-list .diag-x-list li.diag-x-global:hover {
  background: transparent;
}
.diag-x-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  align-self: center;
}
li.error .diag-x-dot,
.diag-x-group-head.error .diag-x-dot {
  background: var(--lf-danger);
}
li.warning .diag-x-dot,
.diag-x-group-head.warning .diag-x-dot {
  background: var(--lf-warning);
}
.diag-x-message {
  flex: 1;
  /* `flex: 1` 的隐含 `min-width: auto` 会让长中文/长路径把 flex 项撑到 min-content，
     在窄栏里表现成**逐字竖排**。必须显式 0 才允许收缩 + 换行。 */
  min-width: 0;
  overflow-wrap: anywhere;
}
/* 指针是**定长标签**，不参与收缩：一旦它可压缩，.diag-x-message 会被挤到 0 宽
   ⇒ 正文逐字换行。 */
.diag-x-pointer {
  flex-shrink: 0;
  max-width: 100%;
  /* 缺 `min-width: 0` 时，长指针（如 `/columns/47/commands/3/resource`）作为
     `flex-shrink:0` 项**不可压缩** ⇒ 撑爆窄栏，右侧诊断被挤成竖条。
     `overflow-wrap: anywhere` 单独不够：还得允许它自身收缩到容器宽。 */
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}
/* 指针独占一行（li 可换行后它自然落到第二行）；正文行至少占满整行宽度 */
.diag-x-pointer {
  flex-basis: 100%;
  color: var(--lf-accent);
  font-size: var(--lf-font-xs);
  opacity: 0.7;
}
</style>

<script setup lang="ts">
/**
 * 快速出餐 · 打包面板（**参数表单 + 结果如实呈现**）。
 *
 * 定位：把「终端跑 `lfenpack`」变成编辑器内一键触发。
 *
 * 三条约定：
 * ① **本组件不 spawn 任何进程** —— 只发请求给本地宿主（浏览器里没有 Node）；
 * ② **结果不美化**：失败就是失败，`stderr` 原样呈现（不只说"出错了"）；
 * ③ **`--force` 需显式勾选且二次确认**（它会**清空输出目录**）。
 */
import { computed, ref } from "vue";
import { useDialog } from "../dialogInjection";

/** 打包请求（与宿主 `packRequestOf` 的入参同名） */
export interface PackRequest {
  /** 工程根（明文，绝对路径） */
  readonly input: string;
  /** 输出根（加密包，绝对路径） */
  readonly output: string;
  readonly force?: boolean;
  readonly strict?: boolean;
  readonly dist?: string;
}

/** 打包结果（宿主回传） */
export interface PackResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

const props = defineProps<{
  /** 是否有本地宿主（无 = 不可打包，如实告知而非假装） */
  readonly canPack: boolean;
  /** 发请求给宿主（由 App 注入，含 token 与错误兜底） */
  readonly send: (request: PackRequest) => Promise<PackResult>;
}>();

const dialog = useDialog();

const input = ref("");
const output = ref("");
const dist = ref("");
const force = ref(false);
const strict = ref(false);
const running = ref(false);
const result = ref<PackResult | undefined>(undefined);

/** 必填项齐备才让点（不靠 disabled 掩盖原因，点了也给提示） */
const ready = computed(() => input.value.trim() !== "" && output.value.trim() !== "");

async function onPack(): Promise<void> {
  if (!props.canPack) {
    await dialog.notify({
      title: "当前形态无法打包",
      message: "打包需要本地宿主（pnpm --filter @lingfan/editor-app host）。请先启动它。",
      tone: "info",
    });
    return;
  }
  if (!ready.value) {
    await dialog.notify({
      title: "请填写工程根与输出根",
      message: "两者都是本机绝对路径（如 E:/proj/game 与 E:/dist/game）。",
      tone: "warning",
    });
    return;
  }
  if (force.value) {
    // --force 会**清空输出目录** ⇒ 必须二次确认，且说清后果
    const ok = await dialog.askConfirm({
      title: "确认覆盖输出目录？",
      message: `「覆盖」会先清空 ${output.value.trim()} 的现有内容，再写入新包。该目录下的其他文件会被删除。`,
      danger: true,
    });
    if (!ok) return;
  }
  running.value = true;
  result.value = undefined;
  try {
    result.value = await props.send({
      input: input.value.trim(),
      output: output.value.trim(),
      force: force.value,
      strict: strict.value,
      ...(dist.value.trim() === "" ? {} : { dist: dist.value.trim() }),
    });
  } finally {
    running.value = false;
  }
}

/** 结果口径：成功/失败各自说清发生了什么（不叙述历史） */
const verdict = computed(() => {
  const r = result.value;
  if (r === undefined) return undefined;
  if (r.ok) return { tone: "ok", title: "打包完成", detail: `退出码 ${String(r.exitCode ?? 0)}` };
  return { tone: "bad", title: "打包未完成", detail: r.reason ?? "未知原因" };
});
</script>

<template>
  <div class="pack">
    <p class="pack-hint">
      产出加密发布包（等价于终端跑 <code>lfenpack</code>）。路径都是本机绝对路径。
    </p>

    <label class="field">
      <span class="field-label">工程根（明文）</span>
      <input v-model="input" class="control" placeholder="E:/proj/game/Resources" />
    </label>
    <label class="field">
      <span class="field-label">输出根（加密包）</span>
      <input v-model="output" class="control" placeholder="E:/dist/game" />
    </label>
    <label class="field">
      <span class="field-label">前端产物目录（可选）</span>
      <input v-model="dist" class="control" placeholder="E:/proj/game/dist" />
    </label>

    <div class="opts">
      <label class="opt">
        <input v-model="force" type="checkbox" />
        <span>覆盖输出目录（先清空）</span>
      </label>
      <label class="opt">
        <input v-model="strict" type="checkbox" />
        <span>严格模式（报告有未入包项即失败）</span>
      </label>
    </div>

    <button class="pack-btn" :disabled="running" @click="onPack">
      {{ running ? "打包中…" : "开始打包" }}
    </button>

    <div v-if="verdict" class="result" :data-tone="verdict.tone">
      <p class="result-title">{{ verdict.title }}</p>
      <p class="result-detail">{{ verdict.detail }}</p>
      <pre v-if="result?.stdout" class="result-log">{{ result.stdout }}</pre>
      <pre v-if="result?.stderr" class="result-log err">{{ result.stderr }}</pre>
    </div>
  </div>
</template>

<style scoped>
.pack {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  overflow: auto;
}
.pack-hint {
  margin: 0;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-hint);
  line-height: 1.6;
}
.pack-hint code {
  font-family: var(--lf-font-mono);
  color: var(--lf-text-secondary);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field-label {
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
}
.opts {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}
.opt {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  cursor: pointer;
}
.pack-btn {
  align-self: flex-start;
}
.result {
  padding: 8px 10px;
  border: 1px solid var(--lf-border-subtle);
  border-radius: var(--lf-radius-md);
}
.result[data-tone="ok"] {
  border-color: color-mix(in srgb, var(--lf-success) 45%, transparent);
}
.result[data-tone="bad"] {
  border-color: color-mix(in srgb, var(--lf-danger) 45%, transparent);
}
.result-title {
  margin: 0 0 4px;
  font-size: var(--lf-font-md);
  color: var(--lf-text-primary);
}
.result[data-tone="ok"] .result-title {
  color: var(--lf-success);
}
.result[data-tone="bad"] .result-title {
  color: var(--lf-danger);
}
.result-detail {
  margin: 0;
  font-size: var(--lf-font-sm);
  color: var(--lf-text-secondary);
  overflow-wrap: anywhere;
}
.result-log {
  margin: 6px 0 0;
  padding: 6px;
  max-height: 180px;
  overflow: auto;
  font-family: var(--lf-font-mono);
  font-size: var(--lf-font-xs);
  color: var(--lf-text-hint);
  background: var(--lf-surface-sunken);
  border-radius: var(--lf-radius-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.result-log.err {
  color: var(--lf-danger);
}
</style>

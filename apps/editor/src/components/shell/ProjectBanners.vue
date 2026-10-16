<script setup lang="ts">
/** 保存/打开反馈区：三条非阻塞横幅 + 保存前规范化确认（清单与真实写回行为一一对应） */
defineProps<{
  openError: string;
  saveError: string;
  saveNotice: string;
  normalizationNotice: string[];
  saving: boolean;
  skipNormalizationNotice: boolean;
}>();

const emit = defineEmits<{
  (e: "dismiss-open-error"): void;
  (e: "dismiss-save-error"): void;
  (e: "dismiss-save-notice"): void;
  (e: "confirm-normalization"): void;
  (e: "cancel-normalization"): void;
  (e: "update:skipNormalizationNotice", value: boolean): void;
}>();
</script>

<template>
  <p v-if="openError !== ''" class="open-error">
    {{ openError }}
    <button @click="emit('dismiss-open-error')">关闭</button>
  </p>

  <p v-if="saveError !== ''" class="save-error">
    {{ saveError }}
    <button @click="emit('dismiss-save-error')">关闭</button>
  </p>

  <p v-if="saveNotice !== ''" class="save-notice">
    {{ saveNotice }}
    <button @click="emit('dismiss-save-notice')">关闭</button>
  </p>

  <!-- 保存前规范化确认：清单 = describeNormalization（与真实写回行为一一对应） -->
  <div v-if="normalizationNotice.length > 0" class="save-normalization">
    <strong>首次保存将把工程文件规范化为标准布局：</strong>
    <ul>
      <li v-for="line in normalizationNotice" :key="line">{{ line }}</li>
    </ul>
    <p class="normalization-note">
      另：列文件按列 id 排序存储；Stories/ 下的空目录不会自动清理。
    </p>
    <div class="normalization-actions">
      <label>
        <input
          :checked="skipNormalizationNotice"
          type="checkbox"
          @change="
            emit('update:skipNormalizationNotice', ($event.target as HTMLInputElement).checked)
          "
        />
        不再提示
      </label>
      <button
        class="save-button"
        :disabled="saving"
        @click="emit('confirm-normalization')"
      >
        {{ saving ? "保存中…" : "继续保存" }}
      </button>
      <button :disabled="saving" @click="emit('cancel-normalization')">
        取消
      </button>
    </div>
  </div>
</template>

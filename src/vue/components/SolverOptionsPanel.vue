<script setup lang="ts">
/**
 * SolverOptionsPanel.vue — 求解方法二级选项面板（框架优先、配置驱动、可拓展）。
 *
 * - 输入：一个 SolverOptionGroup（methodOptions.ts 的 METHOD_OPTION_GROUPS 条目）+ 勾选集合；
 * - 输出：`update:modelValue`（新勾选集合）。
 * - 无硬编码选项名：选项全部来自 methodOptions.ts 配置表 + i18n key，
 *   新增选项只需配置表加条目 + locales 文案，本组件零改动（用户要求「适合拓展的框架」）。
 */
import { computed } from "vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { useI18n } from "../i18n";
import type { SolverOptionGroup, SolverOptions } from "../../cube/solver/methodOptions";

const props = defineProps<{
  group: SolverOptionGroup;
  modelValue: SolverOptions;
}>();

const emit = defineEmits<{ (e: "update:modelValue", v: SolverOptions): void }>();

const { t } = useI18n();

const selected = computed(() => props.modelValue);

const toggle = (id: string, on: boolean): void => {
  emit("update:modelValue", { ...selected.value, [id]: on });
};
</script>

<template>
  <div class="solver-options-panel">
    <WinTextBlock class="opt-group-title" :Text="t(group.groupKey)" FontSize="12" />
    <label v-for="opt in group.options" :key="opt.id" class="opt-row">
      <span class="opt-check">
        <input
          type="checkbox"
          class="opt-input"
          :checked="!!selected[opt.id]"
          @change="toggle(opt.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="opt-label">{{ t(opt.labelKey) }}</span>
      </span>
      <WinTextBlock
        v-if="opt.hintKey"
        class="opt-hint"
        :Text="t(opt.hintKey)"
        FontSize="11"
      />
    </label>
  </div>
</template>

<style scoped>
.solver-options-panel {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 9px;
  background: var(--win-mica-bg, rgba(255, 255, 255, 0.86));
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.opt-group-title {
  margin-bottom: 2px;
  opacity: 0.8;
}
.opt-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
  cursor: pointer;
}
.opt-check {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 22px;
  cursor: pointer;
}
.opt-input {
  width: 16px;
  height: 16px;
  margin: 0;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background: #f2f2f2; /* 浅灰底（用户：黑底不好看，灰一点） */
  border: 1px solid #c8c8c8;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.opt-input:checked {
  background: var(--win-accent, #2266ff);
  border-color: var(--win-accent, #2266ff);
}
.opt-input:checked::after {
  content: "\2713";
  color: #fff;
  font-size: 12px;
  line-height: 1;
}
.opt-label {
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  user-select: none;
}
.opt-hint {
  opacity: 0.5;
  padding-left: 23px;
  user-select: none;
}
</style>
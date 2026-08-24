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
import WinCheckBox from "../../vendor/winui-on-web/components/WinCheckBox.vue";
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
      <WinCheckBox
        class="opt-checkbox"
        :IsChecked="!!selected[opt.id]"
        :Content="t(opt.labelKey)"
        @update:IsChecked="(v?: boolean) => toggle(opt.id, !!v)"
      />
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
  gap: 4px;
  padding: 6px 10px;
  background: var(--win-accent-tint, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--win-border, rgba(0, 0, 0, 0.12));
  border-radius: 6px;
}
.opt-group-title {
  margin-bottom: 2px;
  opacity: 0.9;
}
.opt-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-start;
  cursor: pointer;
}
.opt-checkbox {
  /* WinCheckBox 自身行高即可 */
}
.opt-hint {
  opacity: 0.55;
  padding-left: 24px;
  user-select: none;
}
</style>
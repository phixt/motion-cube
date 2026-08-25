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
import type { SolverOptionGroup, SolverOptions, SolveBaseChoice } from "../../cube/solver/methodOptions";
import type { Face } from "../../cube/stickering";

/** 面序 U/R/F/D/L/B（与 RenderCube FACE_COLORS / solver engine 面序一致） */
const BASE_FACES: Face[] = ["U", "R", "F", "D", "L", "B"];
const FACE_COLORS: Record<Face, string> = {
  U: "#ffffff",
  R: "#ff9900",
  F: "#00ff00",
  D: "#ffff00",
  L: "#ff0000",
  B: "#2266ff",
};

const props = defineProps<{
  group: SolverOptionGroup;
  modelValue: SolverOptions;
  /** 解法底：多选面集合（多色底）；空数组 = 跟随全局底色设置 */
  solveBase?: SolveBaseChoice;
  /** 全局底色（settings.baseFace；重置按钮回归此色） */
  globalBase?: Face;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: SolverOptions): void;
  (e: "update:solveBase", v: SolveBaseChoice): void;
}>();

const { t } = useI18n();

const selected = computed(() => props.modelValue);

const toggle = (id: string, on: boolean): void => {
  emit("update:modelValue", { ...selected.value, [id]: on });
};

/** 当前选中底集合（默认空 = 跟随全局底） */
const bases = computed<Face[]>(() => props.solveBase ?? []);

/** 点选/取消某个底：多选集合；最少保留一个底（最后一个取消被拒绝） */
const toggleBase = (f: Face): void => {
  const cur = bases.value;
  const has = cur.includes(f);
  if (has && cur.length === 1) return;
  emit("update:solveBase", has ? cur.filter((x) => x !== f) : [...cur, f]);
};

/** 重置：回归全局底（默认放全局底色上） */
const resetBase = (): void => {
  emit("update:solveBase", [props.globalBase ?? "D"]);
};
</script>

<template>
  <div class="solver-options-panel">
    <!-- 解法底（多色底 / 6 色底，多选）：默认放全局底色上，可加选其它色、再点取消（最少保留一个）；重置回归全局底 -->
    <div class="base-section">
      <div class="base-head">
        <WinTextBlock class="opt-group-title" :Text="t('solve.baseLabel')" FontSize="12" />
        <button type="button" class="base-reset" @click="resetBase">{{ t("solve.baseReset") }}</button>
      </div>
      <div class="base-row">
        <button
          v-for="f in BASE_FACES"
          :key="f"
          type="button"
          class="base-chip"
          :class="{ on: bases.includes(f) }"
          @click="toggleBase(f)"
        >
          <span class="base-dot" :style="{ background: FACE_COLORS[f] }"></span>
          <span class="base-name">{{ f }}</span>
        </button>
      </div>
    </div>

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
.base-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}
.base-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.base-head .opt-group-title {
  margin-bottom: 0;
}
.base-reset {
  border: none;
  background: transparent;
  color: var(--win-accent, #2266ff);
  font-size: 11px;
  line-height: 1;
  padding: 1px 4px;
  cursor: pointer;
  border-radius: 4px;
  user-select: none;
}
.base-reset:hover {
  background: rgba(34, 102, 255, 0.1);
}
.base-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.base-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 5px;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 12px;
  background: #f2f2f2; /* 浅灰底（与选项勾选框一致） */
  cursor: pointer;
  user-select: none;
}
.base-chip.on {
  border-color: var(--win-accent, #2266ff);
  background: rgba(34, 102, 255, 0.12);
}
.base-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.25);
  display: inline-block;
  flex: none;
}
.base-name {
  font-size: 12px;
  line-height: 1;
  color: var(--text-primary);
}
.opt-hint {
  opacity: 0.5;
  padding-left: 23px;
  user-select: none;
}
</style>
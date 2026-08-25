<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinInfoBar from "../../vendor/winui-on-web/components/WinInfoBar.vue";
import WinSlider from "../../vendor/winui-on-web/components/WinSlider.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import WinToggleSwitch from "../../vendor/winui-on-web/components/WinToggleSwitch.vue";
import { FACES, type Face } from "../../cube/stickering";
import {
  BEGINNER_KEYMAP,
  DEFAULT_EDITOR_ACTIONS,
  DEFAULT_KEYMAP,
  EDITOR_ACTION_ORDER,
  bindingKey,
  findConflicts,
  prettyBinding,
  type EditorAction,
  type KeyBinding,
  type KeymapConfig,
  type SpecialAction,
} from "../../input/keymap";
import {
  loadEditorActionKeys,
  loadKeymap,
  loadSettings,
  saveEditorActionKeys,
  saveKeymap,
  saveSettings,
} from "../../settings";
import { useI18n } from "../i18n";

const { t } = useI18n();

/** 游戏 / 编辑器两个作用域：游戏 = 公式键；编辑器 = 功能键（播放/显隐/步进） */
const scope = ref<"game" | "editor">("game");
const gameCfg = ref<KeymapConfig>(structuredClone(loadKeymap()));
const editorActionCfg = ref(loadEditorActionKeys());
const settings = ref(loadSettings());
const capturing = ref<string | null>(null);
const savedFlash = ref(false);
let captureCleanup: (() => void) | null = null;

const FACE_SWATCH: Record<Face, string> = {
  U: "#f8f8f8",
  D: "#ffd24d",
  L: "#ff9d4d",
  R: "#e05555",
  F: "#5fbf6e",
  B: "#4a6fd4",
};

const SPECIAL_LABEL_KEYS: Record<SpecialAction, string> = {
  undo: "keymap.special.undo",
  reset: "keymap.special.reset",
  "toggle-play": "keymap.special.play",
};

const EDITOR_ACTION_LABEL_KEYS: Record<EditorAction, string> = {
  play: "keymap.editor.play",
  "toggle-cube": "keymap.editor.cube",
  "toggle-hand": "keymap.editor.hand",
  "step-back": "keymap.editor.stepBack",
  "step-forward": "keymap.editor.stepForward",
  "jump-prev": "keymap.editor.jumpPrev",
  "jump-next": "keymap.editor.jumpNext",
};

type Row = { action: string; label: string; binding: KeyBinding; isSpecial: boolean };

const moveRows = computed<Row[]>(() =>
  Object.entries(gameCfg.value.moves).map(([action, binding]) => ({
    action,
    label: action,
    binding,
    isSpecial: false,
  })),
);

const specialRows = computed<Row[]>(() =>
  Object.entries(gameCfg.value.specials).map(([action, binding]) => ({
    action,
    label: t(SPECIAL_LABEL_KEYS[action as SpecialAction]),
    binding,
    isSpecial: true,
  })),
);

/** 编辑器功能键行（播放/魔方显隐/手显隐/逐帧与跳关键帧） */
const editorRows = computed<Row[]>(() =>
  EDITOR_ACTION_ORDER.map((action) => ({
    action,
    label: t(EDITOR_ACTION_LABEL_KEYS[action]),
    binding: editorActionCfg.value[action],
    isSpecial: true,
  })),
);

const bindingText = (row: Row): string =>
  capturing.value === row.action ? t("keymap.captureHint") : prettyBinding(row.binding);

/** 冲突检测：游戏公式键 / 编辑器功能键各自独立 */
const conflicts = computed(() => {
  if (scope.value === "game") return findConflicts(gameCfg.value);
  const seen = new Map<string, { binding: KeyBinding; actions: string[] }>();
  for (const [action, b] of Object.entries(editorActionCfg.value)) {
    const k = bindingKey(b);
    const entry = seen.get(k) ?? { binding: b, actions: [] };
    entry.actions.push(action);
    seen.set(k, entry);
  }
  return [...seen.values()].filter((e) => e.actions.length > 1);
});
const conflictText = computed(() => {
  if (conflicts.value.length === 0) return "";
  return (
    t("keymap.conflictPrefix") +
    conflicts.value
      .map(
        (c) =>
          `${c.actions.join(` ${t("keymap.conflictAnd")} `)} ${t("keymap.conflictShare")} ${prettyBinding(c.binding)}`,
      )
      .join("；")
  );
});

const persist = (): void => {
  if (scope.value === "game") saveKeymap(gameCfg.value);
  else saveEditorActionKeys(editorActionCfg.value);
  savedFlash.value = true;
  window.setTimeout(() => (savedFlash.value = false), 1200);
};

const cooldownMs = computed({
  get: () => settings.value.moveCooldownMs,
  set: (v: number) => {
    settings.value.moveCooldownMs = v;
    saveSettings(settings.value);
  },
});

const stopCapture = (): void => {
  captureCleanup?.();
  captureCleanup = null;
  capturing.value = null;
};

const startCapture = (row: Row): void => {
  stopCapture();
  capturing.value = row.action;
  savedFlash.value = false;
  let spaceHeld = false;
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") spaceHeld = false;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      spaceHeld = true;
      e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    captureCleanup?.();
    captureCleanup = null;
    capturing.value = null;
    if (e.code === "Escape") return;
    const nb: KeyBinding = { code: e.code, shift: e.shiftKey, space: spaceHeld };
    if (scope.value === "editor") {
      editorActionCfg.value[row.action as EditorAction] = nb;
    } else if (row.isSpecial) {
      gameCfg.value.specials[row.action as SpecialAction] = nb;
    } else {
      gameCfg.value.moves[row.action] = nb;
    }
    persist();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  captureCleanup = () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKeyUp);
  };
};

const resetAll = (): void => {
  if (scope.value === "game") gameCfg.value = structuredClone(DEFAULT_KEYMAP);
  else editorActionCfg.value = structuredClone(DEFAULT_EDITOR_ACTIONS);
  persist();
};

const loadPreset = (preset: KeymapConfig): void => {
  gameCfg.value = structuredClone(preset);
  persist();
};

const pickBase = (face: Face): void => {
  settings.value.baseFace = face;
  saveSettings(settings.value);
};

const randomBase = (): void => {
  const faces = [...FACES];
  pickBase(faces[Math.floor(Math.random() * faces.length)]);
};

const rulerEnabled = computed({
  get: () => settings.value.rulerEnabled,
  set: (v: boolean) => {
    settings.value.rulerEnabled = v;
    saveSettings(settings.value);
  },
});

const sixColorBase = computed({
  get: () => settings.value.sixColorBase,
  set: (v: boolean) => {
    settings.value.sixColorBase = v;
    saveSettings(settings.value);
  },
});

onBeforeUnmount(stopCapture);
</script>

<template>
  <div class="keymap-page">
    <WinTextBlock class="page-title" :Text="t('keymap.title')" FontSize="28" FontWeight="SemiBold" />
    <div v-if="savedFlash" class="save-status">{{ t("keymap.saved") }}</div>

    <div class="scope-switch">
      <WinButton
        class="scope-btn"
        :class="{ active: scope === 'game' }"
        :Content="t('keymap.scope.game')"
        @Click="scope = 'game'" />
      <WinButton
        class="scope-btn"
        :class="{ active: scope === 'editor' }"
        :Content="t('keymap.scope.editor')"
        @Click="scope = 'editor'" />
    </div>

    <WinInfoBar
      v-if="conflicts.length"
      IsOpen
      Severity="Warning"
      :Title="t('keymap.conflictTitle')"
      :Message="conflictText" />

    <table class="keymap-table">
      <thead>
        <tr>
          <th>{{ t("keymap.action") }}</th>
          <th>{{ t("keymap.binding") }}</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <template v-if="scope === 'game'">
          <tr v-for="row in moveRows" :key="row.action" :data-action="row.action">
            <td>{{ row.label }}</td>
            <td><span class="binding">{{ bindingText(row) }}</span></td>
            <td>
              <WinButton class="rebind" :Content="t('keymap.modify')" @Click="startCapture(row)" />
            </td>
          </tr>
          <tr class="sep">
            <td colspan="3">{{ t("keymap.special") }}</td>
          </tr>
          <tr v-for="row in specialRows" :key="row.action" :data-action="row.action">
            <td>{{ row.label }}</td>
            <td><span class="binding">{{ bindingText(row) }}</span></td>
            <td>
              <WinButton class="rebind" :Content="t('keymap.modify')" @Click="startCapture(row)" />
            </td>
          </tr>
        </template>
        <template v-else>
          <tr v-for="row in editorRows" :key="row.action" :data-action="row.action">
            <td>{{ row.label }}</td>
            <td><span class="binding">{{ bindingText(row) }}</span></td>
            <td>
              <WinButton class="rebind" :Content="t('keymap.modify')" @Click="startCapture(row)" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <WinTextBlock v-if="scope === 'editor'" class="page-note" :Text="t('keymap.editorNote')" />

    <div v-if="scope === 'game'" class="settings-box">
      <WinTextBlock class="cooldown-label" :Text="t('keymap.cooldown', { ms: cooldownMs })" FontSize="14" />
      <WinSlider class="cooldown-slider" v-model:Value="cooldownMs" :Minimum="0" :Maximum="500" StepFrequency="10" />
    </div>

    <WinButton class="reset-btn" :Content="t('keymap.reset')" @Click="resetAll" />
    <div v-if="scope === 'game'" class="preset-row">
      <WinButton class="preset-beginner" :Content="t('keymap.presetBeginner')" @Click="loadPreset(BEGINNER_KEYMAP)" />
      <WinButton class="preset-default" :Content="t('keymap.presetDefault')" @Click="loadPreset(DEFAULT_KEYMAP)" />
    </div>

    <WinTextBlock class="page-title base-title" :Text="t('keymap.baseTitle')" FontSize="20" FontWeight="SemiBold" />
    <div class="base-swatches">
      <button
        v-for="f in FACES"
        :key="f"
        class="base-swatch"
        :class="{ active: settings.baseFace === f }"
        :data-face="f"
        :style="{ background: FACE_SWATCH[f] }"
        :title="f"
        @click="pickBase(f)">
        {{ f }}
      </button>
    </div>
    <WinButton class="random-base" :Content="t('keymap.randomBase')" @Click="randomBase" />
    <div class="settings-box six-color-box">
      <WinTextBlock class="cooldown-label" :Text="t('keymap.sixColorBase')" FontSize="14" />
      <WinToggleSwitch v-model:IsOn="sixColorBase" :OnContent="t('hand.rulerOn')" :OffContent="t('hand.rulerOff')" />
    </div>
    <WinTextBlock class="page-note" :Text="t('keymap.baseNote')" />

    <WinTextBlock class="page-title base-title" :Text="t('keymap.rulerTitle')" FontSize="20" FontWeight="SemiBold" />
    <div class="settings-box">
      <WinTextBlock class="cooldown-label" :Text="t('keymap.rulerEnabled')" FontSize="14" />
      <WinToggleSwitch v-model:IsOn="rulerEnabled" :OnContent="t('hand.rulerOn')" :OffContent="t('hand.rulerOff')" />
    </div>
    <WinTextBlock class="page-note" :Text="t('keymap.note')" />
    <WinTextBlock class="page-note" :Text="t('keymap.scopeNote')" />
  </div>
</template>

<style>
.keymap-page {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 24px 28px;
  color: var(--text-primary);
}

.keymap-table {
  border-collapse: collapse;
  margin-top: 14px;
  min-width: 460px;
  max-width: 720px;
}

.keymap-table th,
.keymap-table td {
  border: 1px solid var(--stroke-divider);
  padding: 6px 10px;
  text-align: left;
  font-size: 14px;
  color: var(--text-primary);
}

.keymap-table th {
  font-weight: 600;
  background: var(--ctrl-fill-default);
}

.keymap-table .sep td {
  color: var(--text-secondary);
  background: var(--ctrl-fill-secondary);
  font-size: 13px;
}

.binding {
  font-family: ui-monospace, Consolas, monospace;
  color: var(--text-primary);
}

.save-status {
  color: var(--SystemFillColorSuccessBrush, #0f7b0f);
  margin: 8px 0 0 2px;
  font-size: 13px;
}

.settings-box {
  margin-top: 18px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.cooldown-label {
  color: var(--text-secondary);
}

.cooldown-slider {
  width: 240px;
}

.reset-btn,
.random-base {
  margin-top: 16px;
}

.scope-switch {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.scope-btn.active {
  outline: 2px solid var(--accent-base);
  outline-offset: 1px;
}

.scope-btn.sync {
  margin-left: auto;
}

.preset-row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.base-title {
  margin-top: 24px;
}

.base-swatches {
  display: flex;
  gap: 8px;
  margin: 10px 0 14px;
}

.base-swatch {
  width: 34px;
  height: 30px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--ControlCornerRadius, 4px);
  color: #101014;
  font-weight: 700;
  cursor: pointer;
}

.base-swatch.active {
  border-color: var(--text-primary);
  outline: 2px solid var(--accent-base);
  outline-offset: 1px;
}

/* 色块悬停保持在自身色系内（微调亮度，不变成灰/白） */
.base-swatch:hover {
  filter: brightness(0.88);
}

.page-note {
  color: var(--text-tertiary);
  font-size: 13px;
  max-width: 720px;
  margin-top: 8px;
}
</style>

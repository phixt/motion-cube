<script setup lang="ts">
/**
 * 手部模型标定页（Vue 迁移版）。
 * 预览为 three.js 的 HandCalibView（含 SVG 标尺），参数输入为原生 number（自管理 value，
 * 保留旧版"输入中途不被回写打断"的行为），保存/重置为 WinButton。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import WinToggleSwitch from "../../vendor/winui-on-web/components/WinToggleSwitch.vue";
import { FINGER_ORDER, type FingerName } from "../../hand/HandRig";
import { HandCalibView } from "../../hand/HandCalibView";
import {
  DEFAULT_HAND_CONFIG,
  loadHandRigConfig,
  saveHandRigConfig,
  type HandRigConfig,
} from "../../hand/handRigStore";
import { loadSettings } from "../../settings";
import { useI18n } from "../i18n";

const { t } = useI18n();

const FINGER_LABELS: Record<FingerName, string> = {
  thumb: t("hand.fingerThumb"),
  index: t("hand.fingerIndex"),
  middle: t("hand.fingerMiddle"),
  ring: t("hand.fingerRing"),
  pinky: t("hand.fingerPinky"),
};

const FINGER_SEGMENTS: Record<FingerName, number> = {
  thumb: 2,
  index: 3,
  middle: 3,
  ring: 3,
  pinky: 3,
};

const cfg = ref<HandRigConfig>(loadHandRigConfig());
const statusText = ref("");
const scaleReadout = ref("");
const previewRef = ref<HTMLElement | null>(null);
const sidePreviewRef = ref<HTMLElement | null>(null);
const rulerEnabled = ref(loadSettings().rulerEnabled);
let calib: HandCalibView | null = null;
let calibSide: HandCalibView | null = null;

const applyRuler = (): void => {
  calib?.setRuler({ enabled: rulerEnabled.value, angle: cfg.value.rulerAngle });
  calibSide?.setRuler({ enabled: rulerEnabled.value, angle: cfg.value.rulerAngle });
};

const onKeyDown = (e: KeyboardEvent): void => {
  // Shift 快速切换水平(0°)/竖直(90°)；输入框内按 Shift 不触发（避免误改写数值）
  if (e.key !== "Shift") return;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
  e.preventDefault();
  cfg.value.rulerAngle = cfg.value.rulerAngle === 0 ? 90 : 0;
  syncInputs();
  applyRuler();
};

const onRulerAngleChange = (angle: number): void => {
  cfg.value.rulerAngle = angle;
  syncInputs();
};

const setStatus = (s: string): void => {
  statusText.value = s;
};

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshRaf = 0;
/** 真正执行重建：双视图 setConfig（全量重建 3D 几何 + 相机适配 + 标尺重画） */
const doRefresh = (): void => {
  calib?.setConfig(cfg.value);
  calibSide?.setConfig(cfg.value);
  const pinkyLen = cfg.value.fingers.pinky.reduce((s, seg) => s + seg.length, 0);
  scaleReadout.value = t("hand.scaleNote", { n: (pinkyLen * cfg.value.handScale).toFixed(2) });
};
/**
 * 输入防抖合并重建（150ms + rAF）：连续键入/拖动期间只记最新值，停顿 150ms 后在下一
 * 动画帧里重建一次——避免每个 @input 事件都同步全量重建（标定页原先每键重建两个 3D 视图）。
 */
const refresh = (): void => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (refreshRaf) cancelAnimationFrame(refreshRaf);
    refreshRaf = requestAnimationFrame(doRefresh);
  }, 150);
};
/** 立即重建（重置/首次挂载用，跳过防抖） */
const refreshNow = (): void => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (refreshRaf) cancelAnimationFrame(refreshRaf);
  doRefresh();
};

const segHeaderLabels = (finger: FingerName): string =>
  Array.from({ length: FINGER_SEGMENTS[finger] }, (_, i) => t("hand.seg", { n: i + 1 })).join("  ");

const inlineFields: { id: string; label: string; get: () => number; set: (v: number) => void; min: number }[] = [
  { id: "palm-width", label: t("hand.palmWidth"), get: () => cfg.value.palm.width, set: (v) => (cfg.value.palm.width = v), min: 0.01 },
  { id: "palm-height", label: t("hand.palmHeight"), get: () => cfg.value.palm.height, set: (v) => (cfg.value.palm.height = v), min: 0.01 },
  { id: "palm-length", label: t("hand.palmLength"), get: () => cfg.value.palm.length, set: (v) => (cfg.value.palm.length = v), min: 0.01 },
  { id: "layout-spacing", label: t("hand.fingerSpacing"), get: () => cfg.value.fingerSpacing, set: (v) => (cfg.value.fingerSpacing = v), min: 0.3 },
  { id: "thumb-x", label: `${t("hand.thumbCorner")} X`, get: () => cfg.value.thumbCorner.x, set: (v) => (cfg.value.thumbCorner.x = v), min: -2 },
  { id: "thumb-y", label: `${t("hand.thumbCorner")} Y`, get: () => cfg.value.thumbCorner.y, set: (v) => (cfg.value.thumbCorner.y = v), min: -1 },
  { id: "thumb-z", label: `${t("hand.thumbCorner")} Z`, get: () => cfg.value.thumbCorner.z, set: (v) => (cfg.value.thumbCorner.z = v), min: -2 },
  { id: "hand-scale", label: "", get: () => cfg.value.handScale, set: (v) => (cfg.value.handScale = v), min: 0.3 },
];

/** 拇指区字段：CMC 外翻三轴（度，整数位）+ 大鱼际椭球（数据单位，两位小数） */
const thumbFields: { id: string; label: string; get: () => number; set: (v: number) => void; min: number; fix: number }[] = [
  { id: "cmc-abduction", label: t("hand.cmcAbduction"), get: () => cfg.value.thumbCmc.abduction, set: (v) => (cfg.value.thumbCmc.abduction = v), min: -90, fix: 0 },
  { id: "cmc-elevation", label: t("hand.cmcElevation"), get: () => cfg.value.thumbCmc.elevation, set: (v) => (cfg.value.thumbCmc.elevation = v), min: -45, fix: 0 },
  { id: "cmc-rotation", label: t("hand.cmcRotation"), get: () => cfg.value.thumbCmc.rotation, set: (v) => (cfg.value.thumbCmc.rotation = v), min: -180, fix: 0 },
  { id: "thenar-width", label: `${t("hand.thenar")}${t("hand.thenarWidth")}`, get: () => cfg.value.thenar.width, set: (v) => (cfg.value.thenar.width = v), min: 0.1, fix: 2 },
  { id: "thenar-height", label: `${t("hand.thenar")}${t("hand.thenarHeight")}`, get: () => cfg.value.thenar.height, set: (v) => (cfg.value.thenar.height = v), min: 0.05, fix: 2 },
  { id: "thenar-length", label: `${t("hand.thenar")}${t("hand.thenarLength")}`, get: () => cfg.value.thenar.length, set: (v) => (cfg.value.thenar.length = v), min: 0.1, fix: 2 },
  { id: "thenar-y", label: `${t("hand.thenar")} Y`, get: () => cfg.value.thenar.y, set: (v) => (cfg.value.thenar.y = v), min: -1, fix: 2 },
];

/** low-poly 造型字段（v4 shape，阶段1 粗粒度全局参数） */
const shapeFields: { id: string; label: string; get: () => number; set: (v: number) => void; min: number; fix: number }[] = [
  { id: "shape-facets", label: t("hand.shapeFacets"), get: () => cfg.value.shape.facets, set: (v) => (cfg.value.shape.facets = v), min: 4, fix: 0 },
  { id: "shape-bulge", label: t("hand.shapeBulge"), get: () => cfg.value.shape.knuckleBulge, set: (v) => (cfg.value.shape.knuckleBulge = v), min: 1, fix: 2 },
  { id: "shape-shaft", label: t("hand.shapeShaft"), get: () => cfg.value.shape.shaftTaper, set: (v) => (cfg.value.shape.shaftTaper = v), min: 0.6, fix: 2 },
  { id: "shape-tip", label: t("hand.shapeTip"), get: () => cfg.value.shape.tipTaper, set: (v) => (cfg.value.shape.tipTaper = v), min: 0.3, fix: 2 },
  { id: "shape-padflat", label: t("hand.shapePadFlat"), get: () => cfg.value.shape.padFlat, set: (v) => (cfg.value.shape.padFlat = v), min: 0, fix: 2 },
  { id: "shape-arch", label: t("hand.shapeArch"), get: () => cfg.value.shape.arch, set: (v) => (cfg.value.shape.arch = v), min: 0, fix: 2 },
  { id: "shape-palmtaper", label: t("hand.shapePalmTaper"), get: () => cfg.value.shape.palmTaper, set: (v) => (cfg.value.shape.palmTaper = v), min: 0.5, fix: 2 },
  { id: "shape-palmcup", label: t("hand.shapePalmCup"), get: () => cfg.value.shape.palmCup, set: (v) => (cfg.value.shape.palmCup = v), min: 0, fix: 2 },
  { id: "shape-web", label: t("hand.shapeWeb"), get: () => cfg.value.shape.web, set: (v) => (cfg.value.shape.web = v), min: 0, fix: 2 },
  { id: "shape-jitter", label: t("hand.shapeJitter"), get: () => cfg.value.shape.facetJitter, set: (v) => (cfg.value.shape.facetJitter = v), min: 0, fix: 2 },
];

/** id → setter 注册表：模板用统一 @input 处理器分发（避免事件表达式返回值被丢弃） */
const fieldSetters = new Map<string, (v: number) => void>();
for (const name of FINGER_ORDER) {
  for (let s = 0; s < FINGER_SEGMENTS[name]; s++) {
    fieldSetters.set(`len-${name}-${s}`, (v) => {
      cfg.value.fingers[name][s].length = v;
      refresh();
    });
    fieldSetters.set(`width-${name}-${s}`, (v) => {
      cfg.value.fingers[name][s].width = v;
      refresh();
    });
  }
}
for (const f of inlineFields) {
  fieldSetters.set(f.id, (v) => {
    f.set(v);
    refresh();
  });
}
for (const f of thumbFields) {
  fieldSetters.set(f.id, (v) => {
    f.set(v);
    refresh();
  });
}
for (const f of shapeFields) {
  fieldSetters.set(f.id, (v) => {
    f.set(v);
    refresh();
  });
}
fieldSetters.set("ruler-angle", (v) => {
  cfg.value.rulerAngle = v;
  applyRuler();
});

const onFieldInput = (e: Event): void => {
  const el = e.target as HTMLInputElement;
  const set = fieldSetters.get(el.id);
  if (!set) return;
  const v = Number((e.target as HTMLInputElement).value);
  // 按字段 min 放行（thumb-x/y/z 允许负值）；NaN/空串被挡
  const min = el.min !== "" ? Number(el.min) : 0;
  if (Number.isFinite(v) && v >= min) set(v);
};

const syncInputs = (): void => {
  for (const name of FINGER_ORDER) {
    for (let s = 0; s < FINGER_SEGMENTS[name]; s++) {
      const len = document.getElementById(`len-${name}-${s}`) as HTMLInputElement | null;
      const wid = document.getElementById(`width-${name}-${s}`) as HTMLInputElement | null;
      if (len) len.value = cfg.value.fingers[name][s].length.toFixed(2);
      if (wid) wid.value = cfg.value.fingers[name][s].width.toFixed(2);
    }
  }
  for (const f of inlineFields) {
    const input = document.getElementById(f.id) as HTMLInputElement | null;
    if (input) input.value = f.get().toFixed(2);
  }
  for (const f of thumbFields) {
    const input = document.getElementById(f.id) as HTMLInputElement | null;
    if (input) input.value = f.get().toFixed(f.fix);
  }
  for (const f of shapeFields) {
    const input = document.getElementById(f.id) as HTMLInputElement | null;
    if (input) input.value = f.get().toFixed(f.fix);
  }
  const ra = document.getElementById("ruler-angle") as HTMLInputElement | null;
  if (ra) ra.value = cfg.value.rulerAngle.toFixed(0);
};

const save = (): void => {
  saveHandRigConfig(cfg.value);
  setStatus(t("hand.saved"));
};

const reset = (): void => {
  cfg.value = structuredClone(DEFAULT_HAND_CONFIG);
  syncInputs();
  refreshNow();
  setStatus(t("hand.resetOk"));
};

onMounted(() => {
  if (!previewRef.value || !sidePreviewRef.value) return;
  calib = new HandCalibView(previewRef.value, cfg.value, "top");
  calibSide = new HandCalibView(sidePreviewRef.value, cfg.value, "left");
  calib.setRulerChangeHandler(onRulerAngleChange);
  calibSide.setRulerChangeHandler(onRulerAngleChange);
  (globalThis as { __motionCubeHandCalib?: unknown }).__motionCubeHandCalib = { calib, calibSide };
  syncInputs();
  refreshNow();
  applyRuler();
  window.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (refreshRaf) cancelAnimationFrame(refreshRaf);
  refreshRaf = 0;
  calib?.dispose();
  calibSide?.dispose();
  calib = null;
  calibSide = null;
  delete (globalThis as { __motionCubeHandCalib?: unknown }).__motionCubeHandCalib;
});
</script>

<template>
  <div class="hand-calib-page">
    <WinTextBlock class="page-title" :Text="t('hand.title')" FontSize="28" FontWeight="SemiBold" />
    <div id="hand-status" class="save-status">{{ statusText }}</div>

    <div class="hand-calib">
      <div class="hand-preview-wrap">
        <div class="hand-views">
          <div class="hand-view-box">
            <div ref="previewRef" id="hand-calib-view" class="hand-preview"></div>
            <WinTextBlock class="hand-view-label" :Text="t('hand.viewTop')" FontSize="12" />
          </div>
          <div class="hand-view-box">
            <div ref="sidePreviewRef" id="hand-calib-side-view" class="hand-preview"></div>
            <WinTextBlock class="hand-view-label" :Text="t('hand.viewLeft')" FontSize="12" />
          </div>
        </div>
        <WinTextBlock class="hand-unit-note" :Text="t('hand.rulerUnit')" FontSize="12" />
        <WinTextBlock class="page-note" :Text="t('hand.viewHint')" />
      </div>

      <div class="hand-controls">
        <!-- 手指段参数 -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.fingers')" FontSize="16" FontWeight="SemiBold" />
          <table class="hand-rig-table">
            <thead>
              <tr>
                <th></th>
                <th v-for="name in FINGER_ORDER" :key="name">{{ FINGER_LABELS[name] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="hand-rig-rowhead">{{ t("hand.len") }}</td>
                <td v-for="name in FINGER_ORDER" :key="'len-' + name">
                  <span v-for="s in FINGER_SEGMENTS[name]" :key="s">
                    <input
                      :id="`len-${name}-${s - 1}`"
                      type="number"
                      step="0.01"
                      min="0.01"
                      class="native-num"
                      @input="onFieldInput" />
                  </span>
                </td>
              </tr>
              <tr>
                <td class="hand-rig-rowhead">{{ t("hand.width") }}</td>
                <td v-for="name in FINGER_ORDER" :key="'width-' + name">
                  <span v-for="s in FINGER_SEGMENTS[name]" :key="s">
                    <input
                      :id="`width-${name}-${s - 1}`"
                      type="number"
                      step="0.01"
                      min="0.01"
                      class="native-num"
                      @input="onFieldInput" />
                  </span>
                </td>
              </tr>
              <tr>
                <td></td>
                <td v-for="name in FINGER_ORDER" :key="'seg-' + name">
                  <span class="hand-seg-label">{{ segHeaderLabels(name) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 手掌 -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.palm')" FontSize="16" FontWeight="SemiBold" />
          <div class="hand-inline">
            <label v-for="f in inlineFields.slice(0, 3)" :key="f.id" class="hand-inline-item">
              {{ f.label }}
              <input :id="f.id" type="number" step="0.01" :min="String(f.min)" class="native-num" @input="onFieldInput" />
            </label>
          </div>
        </section>

        <!-- 布局 -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.layout')" FontSize="16" FontWeight="SemiBold" />
          <div class="hand-inline">
            <label v-for="f in inlineFields.slice(3, 7)" :key="f.id" class="hand-inline-item">
              {{ f.label }}
              <input :id="f.id" type="number" step="0.01" :min="String(f.min)" class="native-num" @input="onFieldInput" />
            </label>
          </div>
        </section>

        <!-- 拇指（CMC 外翻 + 大鱼际） -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.thumb')" FontSize="16" FontWeight="SemiBold" />
          <div class="hand-inline">
            <label v-for="f in thumbFields" :key="f.id" class="hand-inline-item">
              {{ f.label }}
              <input :id="f.id" type="number" :step="f.fix === 0 ? '1' : '0.01'" :min="String(f.min)" class="native-num" @input="onFieldInput" />
            </label>
          </div>
          <WinTextBlock class="page-note" :Text="t('hand.cmcHint')" FontSize="12" />
        </section>

        <!-- 造型（low-poly v4 shape） -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.shape')" FontSize="16" FontWeight="SemiBold" />
          <div class="hand-inline">
            <label v-for="f in shapeFields" :key="f.id" class="hand-inline-item">
              {{ f.label }}
              <input :id="f.id" type="number" :step="f.fix === 0 ? '1' : '0.01'" :min="String(f.min)" class="native-num" @input="onFieldInput" />
            </label>
          </div>
          <WinTextBlock class="page-note" :Text="t('hand.viewHint')" FontSize="12" />
        </section>

        <!-- 整体 -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.scale')" FontSize="16" FontWeight="SemiBold" />
          <div class="hand-inline">
            <label class="hand-inline-item">
              <input id="hand-scale" type="number" step="0.01" min="0.3" class="native-num" @input="onFieldInput" />
            </label>
            <span id="hand-scale-readout" class="hand-scale-readout">{{ scaleReadout }}</span>
          </div>
        </section>

        <!-- 标尺角度 -->
        <section class="hand-section">
          <WinTextBlock class="hand-h3" :Text="t('hand.ruler')" FontSize="16" FontWeight="SemiBold" />
          <div class="hand-inline">
            <label class="hand-inline-item">
              {{ t("hand.rulerAngle") }}°
              <input id="ruler-angle" type="number" step="1" min="0" max="360" class="native-num" @input="onFieldInput" />
            </label>
          </div>
        </section>

        <div class="hand-actions">
          <div class="hand-ruler-row">
            <WinTextBlock class="editor-label" :Text="t('hand.ruler')" FontSize="14" />
            <WinToggleSwitch v-model:IsOn="rulerEnabled" :OnContent="t('hand.rulerOn')" :OffContent="t('hand.rulerOff')" @Toggled="applyRuler" />
          </div>
          <WinButton id="hand-save" :Content="t('hand.save')" Style="AccentButtonStyle" @Click="save" />
          <WinButton id="hand-reset" :Content="t('hand.reset')" @Click="reset" />
        </div>
        <WinTextBlock class="page-note" :Text="t('hand.rulerHint')" />
      </div>
    </div>
  </div>
</template>

<style>
.hand-calib-page {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 24px 28px;
  color: var(--text-primary);
}

.save-status {
  color: var(--SystemFillColorSuccessBrush, #0f7b0f);
  font-size: 13px;
  margin-top: 6px;
}

.hand-calib {
  display: flex;
  gap: 24px;
  margin-top: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.hand-preview-wrap {
  flex: 1 1 420px;
  min-width: 320px;
}

.hand-preview {
  position: relative;
  width: 100%;
  min-height: 340px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-solid-fill, #101014);
  overflow: hidden;
}

.hand-views {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.hand-view-box {
  flex: 1 1 300px;
  min-width: 280px;
}

.hand-view-box:first-child {
  flex-basis: 280px; /* 俯视图：窄高 */
}

.hand-view-box:last-child {
  flex-basis: 380px; /* 左视图：宽些，缓解手指长轴取景 */
}

.hand-view-label {
  display: block;
  margin-top: 4px;
  color: var(--text-tertiary);
}

.hand-unit-note {
  color: var(--text-tertiary);
  margin-top: 6px;
}

.hand-controls {
  flex: 1 1 420px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hand-h3 {
  display: block;
  margin-bottom: 8px;
}

.hand-rig-table {
  border-collapse: collapse;
  width: 100%;
}

.hand-rig-table th,
.hand-rig-table td {
  border: 1px solid var(--stroke-divider);
  padding: 4px 6px;
  font-size: 13px;
  text-align: center;
}

.hand-rig-table th {
  font-weight: 600;
  background: var(--ctrl-fill-default);
}

.hand-rig-rowhead {
  color: var(--text-secondary);
}

.hand-seg-label {
  color: var(--text-tertiary);
  font-size: 11px;
}

.native-num {
  width: 64px;
  box-sizing: border-box;
  margin: 1px;
  padding: 3px 6px;
  border: 1px solid var(--ctrl-border);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--ctrl-fill-input-active, var(--ctrl-solid-fill));
  color: var(--text-primary);
  font-size: 13px;
}

.hand-inline {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.hand-inline-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 13px;
}

.hand-scale-readout {
  color: var(--text-secondary);
  font-size: 13px;
}

.hand-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.hand-ruler-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-note {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 6px;
}
</style>

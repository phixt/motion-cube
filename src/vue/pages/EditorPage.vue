<script setup lang="ts">
/**
 * 动画编辑器（Vue 迁移版）：时间线/关键帧/补帧预览/3D 视口全部声明式重写。
 * 测试依赖的控件保持原生（select/number/range，playtest 直接操作 DOM），
 * 按钮与标题使用 Win 控件。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import { CubePlayer } from "../../cube/CubePlayer";
import { loadLibrary, saveLibrary, upsertTechniqueInLib } from "../../data/libraryStore";
import {
  createTechnique,
  removeKeyframe,
  upsertKeyframe,
  type Easing,
  type Technique,
} from "../../data/technique";
import { defaultHandPose, FINGER_ORDER, type HandType, type Pose } from "../../hand/HandRig";
import { HandRigView } from "../../hand/HandRigView";
import {
  applyEasing,
  interpolatePose,
  keyframeSegment,
  type EasingFn,
} from "../../timeline/Timeline";
import { useI18n } from "../i18n";

const { t } = useI18n();

const PX_PER_FRAME = 2;
const PREVIEW_SAMPLE_STEP = 15;

const lib = ref(loadLibrary());
const tech = ref<Technique | null>(null);
const selectedFrame = ref<number | null>(null);
const playing = ref(false);
const previewFrame = ref(0);
const statusText = ref("");

const editorViewEl = ref<HTMLElement | null>(null);
const tecSelectEl = ref<HTMLSelectElement | null>(null);
const handTypeSelectEl = ref<HTMLSelectElement | null>(null);
const formulaLabelEl = ref<HTMLElement | null>(null);
const emptyHintEl = ref<HTMLElement | null>(null);
const newNameEl = ref<HTMLInputElement | null>(null);
const newFormulaEl = ref<HTMLSelectElement | null>(null);
const tlMetaEl = ref<HTMLElement | null>(null);
const kfFrameEl = ref<HTMLInputElement | null>(null);
const kfEasingEl = ref<HTMLSelectElement | null>(null);
const kfDeleteEl = ref<HTMLButtonElement | null>(null);
const kfPoseEl = ref<HTMLElement | null>(null);
const addFrameEl = ref<HTMLInputElement | null>(null);
const btnPlayEl = ref<HTMLButtonElement | null>(null);
const pvSliderEl = ref<HTMLInputElement | null>(null);
const pvReadoutEl = ref<HTMLElement | null>(null);
const pvPoseEl = ref<HTMLElement | null>(null);

let player: CubePlayer | null = null;
let handView: HandRigView | null = null;
let timer: number | null = null;

const totalFrames = computed(() => {
  if (!tech.value || tech.value.keyframes.length === 0) return 0;
  return Math.max(tech.value.keyframes[tech.value.keyframes.length - 1].frame, 60);
});

const sortedKeyframes = computed(() =>
  tech.value ? [...tech.value.keyframes].sort((a, b) => a.frame - b.frame) : [],
);

const rulerTicks = computed(() => {
  const ticks: { frame: number; major: boolean }[] = [];
  const total = totalFrames.value;
  for (let f = 0; f <= total; f++) {
    if (f % 60 === 0) ticks.push({ frame: f, major: true });
    else if (f % 15 === 0) ticks.push({ frame: f, major: false });
  }
  return ticks;
});

const tlWidth = computed(() => `${Math.max(totalFrames.value, 60) * PX_PER_FRAME}px`);

const stepBands = computed(() => tech.value?.stepMapping ?? []);

const kfDeleteEnabled = computed(() =>
  selectedFrame.value !== null &&
  !!tech.value?.keyframes.find((k) => k.frame === selectedFrame.value),
);

const techniqueOptions = computed(() => [
  { id: "", name: t("library.noneCategory") },
  ...lib.value.techniques.map((x) => ({ id: x.id, name: x.name })),
]);

const formulaOptions = computed(() => [
  { id: "", name: t("library.noneCategory") },
  ...lib.value.formulas.map((f) => ({ id: f.id, name: f.name })),
]);

const handTypeOptions = [
  { value: "left", label: t("editor.handLeft") },
  { value: "right", label: t("editor.handRight") },
];

const pvHeaders = computed(() => [
  t("editor.frame"),
  t("editor.sec"),
  "IP/PIP(°)",
  "DIP/MCP(°)",
  "contact",
]);

/** 姿态摘要：各指 PIP（拇指 IP）等数值 */
function jointName(name: string): string {
  return name === "thumb" ? "IP" : "PIP";
}

function poseSummary(pose: Pose): string {
  const lines = FINGER_ORDER.map((name) => {
    const arr = pose.bends[name];
    const joint = name === "thumb" ? 2 : 1;
    const tip = name === "thumb" ? 1 : 2;
    return `${name.padEnd(6)} ${jointName(name)}:${Math.round(arr[joint] ?? 0)}°  DIP/MCP:${Math.round(arr[tip] ?? 0)}°`;
  });
  lines.push(`thumbCMC ab:${Math.round(pose.thumbCMC.abduction)} rot:${Math.round(pose.thumbCMC.rotation)}`);
  lines.push(
    `palm pos (${pose.palm.transform.position.x.toFixed(2)}, ${pose.palm.transform.position.y.toFixed(2)}, ${pose.palm.transform.position.z.toFixed(2)})`,
  );
  lines.push(`contacts: ${pose.contacts.length ? pose.contacts.map((c) => `${c.finger}→${c.target}`).join(", ") : "—"}`);
  return lines.join("\n");
}

/** 当前预览帧的插值姿态（<2 关键帧时取唯一帧或 null） */
function previewPose(): Pose | null {
  if (!tech.value || tech.value.keyframes.length === 0) return null;
  if (tech.value.keyframes.length === 1) return tech.value.keyframes[0].pose;
  const sorted = sortedKeyframes.value;
  const seg = keyframeSegment(sorted, previewFrame.value);
  if (!seg) return sorted[0].pose;
  if (seg.a === seg.b) return seg.a.pose;
  const eased = applyEasing((seg.a.easing ?? "linear") as EasingFn, seg.local);
  return interpolatePose(seg.a.pose, seg.b.pose, eased);
}

const previewTableRows = computed(() => {
  const total = totalFrames.value;
  if (!tech.value || tech.value.keyframes.length < 2) return null;
  const rows: { frame: number; sec: string; ip: number; dip: number; contact: string }[] = [];
  const sorted = sortedKeyframes.value;
  for (let f = 0; f <= total; f += PREVIEW_SAMPLE_STEP) {
    const seg = keyframeSegment(sorted, f);
    if (!seg) continue;
    const pose =
      seg.a === seg.b
        ? seg.a.pose
        : interpolatePose(seg.a.pose, seg.b.pose, applyEasing((seg.a.easing ?? "linear") as EasingFn, seg.local));
    const ip = pose.bends.index[1] ?? 0;
    const dip = pose.bends.index[2] ?? 0;
    rows.push({
      frame: f,
      sec: (f / tech.value.frameRate).toFixed(2),
      ip: Math.round(ip),
      dip: Math.round(dip),
      contact: pose.contacts.length ? `${pose.contacts[0].finger}→${pose.contacts[0].target}` : "—",
    });
  }
  return rows;
});

function renderSelected(): void {
  const kf =
    selectedFrame.value === null
      ? null
      : tech.value?.keyframes.find((k) => k.frame === selectedFrame.value);
  if (kfFrameEl.value) kfFrameEl.value.value = kf ? String(kf.frame) : "";
  if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
  if (kfPoseEl.value) {
    kfPoseEl.value.textContent = kf ? poseSummary(kf.pose) : tech.value ? t("editor.noKfSelected") : "";
  }
  if (kfDeleteEl.value) kfDeleteEl.value.disabled = !kf;
}

function renderPreview(): void {
  const total = totalFrames.value;
  if (pvSliderEl.value) {
    pvSliderEl.value.max = String(Math.max(total, 0));
    pvSliderEl.value.value = String(Math.min(previewFrame.value, total));
  }
  if (pvReadoutEl.value) {
    pvReadoutEl.value.textContent = tech.value
      ? t("editor.frameOf", {
          frame: previewFrame.value,
          total,
          sec: (previewFrame.value / tech.value.frameRate).toFixed(2),
        })
      : "";
  }
  const pose = previewPose();
  if (pvPoseEl.value) pvPoseEl.value.textContent = pose ? poseSummary(pose) : t("editor.needKf");
  if (handView) {
    handView.setPose(pose ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "left"));
  }
}

function renderAll(): void {
  if (tecSelectEl.value) tecSelectEl.value.value = tech.value?.id ?? "";
  if (formulaLabelEl.value) {
    formulaLabelEl.value.textContent = tech.value
      ? `${t("editor.formula")}: ${lib.value.formulas.find((f) => f.id === tech.value!.formulaId)?.name ?? "?"}`
      : "";
  }
  if (emptyHintEl.value) emptyHintEl.value.hidden = lib.value.techniques.length > 0;
  if (tlMetaEl.value) {
    tlMetaEl.value.textContent = tech.value
      ? `${t("editor.kfCount", { n: tech.value.keyframes.length })} ｜ ${t("editor.totalFrames", {
          n: totalFrames.value,
          sec: (totalFrames.value / tech.value.frameRate).toFixed(2),
        })} ｜ ${t("editor.steps", { n: tech.value.stepMapping.length })}`
      : "";
  }
  renderSelected();
  renderPreview();
}

function selectTech(id: string): void {
  selectedFrame.value = null;
  previewFrame.value = 0;
  tech.value = lib.value.techniques.find((x) => x.id === id) ?? null;
  const f = tech.value ? lib.value.formulas.find((x) => x.id === tech.value!.formulaId) : undefined;
  player?.setMoves(f?.moves ?? "");
  renderAll();
}

function commit(fn: (t2: Technique) => Technique): void {
  if (!tech.value) return;
  try {
    tech.value = fn(tech.value);
    renderAll();
  } catch (e) {
    statusText.value = t("editor.kfFail", { error: e instanceof Error ? e.message : String(e) });
  }
}

const onTecChange = (e: Event): void => {
  selectTech((e.target as HTMLSelectElement).value);
};

const onHandTypeChange = (e: Event): void => {
  handView?.setHandType((e.target as HTMLSelectElement).value as HandType);
};

const onNewAdd = (): void => {
  const name = newNameEl.value?.value.trim() ?? "";
  const formulaId = newFormulaEl.value?.value ?? "";
  if (!name) {
    statusText.value = t("editor.newFail");
    return;
  }
  if (!formulaId) {
    statusText.value = t("editor.newFailFormula");
    return;
  }
  const created = createTechnique({ name, formulaId });
  lib.value = upsertTechniqueInLib(lib.value, created);
  saveLibrary(lib.value);
  if (newNameEl.value) newNameEl.value.value = "";
  selectTech(created.id);
  statusText.value = t("editor.saved");
};

const onKfFrameChange = (e: Event): void => {
  if (!tech.value || selectedFrame.value === null) return;
  const target = Number((e.target as HTMLInputElement).value);
  if (!Number.isInteger(target) || target < 0) {
    statusText.value = t("editor.kfFail", { error: t("editor.frameInvalid") });
    renderSelected();
    return;
  }
  const kf = tech.value.keyframes.find((k) => k.frame === selectedFrame.value);
  if (!kf) return;
  commit((t2) => {
    const moved = upsertKeyframe(t2, { ...kf, frame: target });
    return removeKeyframe(moved, selectedFrame.value!);
  });
  selectedFrame.value = target;
  renderAll();
};

const onKfEasingChange = (e: Event): void => {
  if (!tech.value || selectedFrame.value === null) return;
  const kf = tech.value.keyframes.find((k) => k.frame === selectedFrame.value);
  if (!kf) return;
  commit((t2) => upsertKeyframe(t2, { ...kf, easing: (e.target as HTMLSelectElement).value as Easing }));
};

const onKfDelete = (): void => {
  if (!tech.value || selectedFrame.value === null) return;
  commit((t2) => removeKeyframe(t2, selectedFrame.value!));
  selectedFrame.value = null;
  renderAll();
};

const onKfAdd = (): void => {
  if (!tech.value) return;
  const target = Number(addFrameEl.value?.value);
  if (!Number.isInteger(target) || target < 0) {
    statusText.value = t("editor.frameInvalid");
    return;
  }
  commit((t2) => {
    let src: Pose | undefined;
    const sel = t2.keyframes.find((k) => k.frame === selectedFrame.value);
    if (sel) src = sel.pose;
    else {
      const sorted = [...t2.keyframes].sort((a, b) => a.frame - b.frame);
      let prev: Pose | undefined;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].frame < target) {
          prev = sorted[i].pose;
          break;
        }
      }
      if (prev) src = prev;
    }
    const pose = src ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "left");
    return upsertKeyframe(t2, { frame: target, pose });
  });
  selectedFrame.value = target;
  renderAll();
};

const onPvPlay = (): void => {
  if (!tech.value) return;
  playing.value = !playing.value;
  if (btnPlayEl.value) btnPlayEl.value.textContent = t(playing.value ? "editor.pause" : "editor.play");
};

const onPvInput = (e: Event): void => {
  previewFrame.value = Number((e.target as HTMLInputElement).value);
  renderPreview();
};

const onSave = (): void => {
  if (!tech.value) return;
  try {
    lib.value = upsertTechniqueInLib(lib.value, tech.value);
    saveLibrary(lib.value);
    statusText.value = t("editor.saved");
  } catch (e) {
    statusText.value = t("editor.saveFail", { error: e instanceof Error ? e.message : String(e) });
  }
};

const selectKf = (frame: number): void => {
  selectedFrame.value = frame;
  previewFrame.value = frame;
  renderAll();
};

onMounted(() => {
  if (!editorViewEl.value) return;
  player = new CubePlayer(editorViewEl.value, { cameraDistance: 8 });
  handView = new HandRigView(player);
  void handView.init();
  (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor = { player, handView };
  renderAll();
  timer = window.setInterval(() => {
    if (!playing.value || !tech.value) return;
    const total = totalFrames.value;
    if (previewFrame.value >= total) previewFrame.value = 0;
    else previewFrame.value += 1;
    renderPreview();
  }, 1000 / 60);
});

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
  editorViewEl.value?.replaceChildren();
  delete (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor;
  player = null;
  handView = null;
});
</script>

<template>
  <div class="editor-page">
    <WinTextBlock class="page-title" :Text="t('editor.title')" FontSize="28" FontWeight="SemiBold" />
    <div id="editor-status" class="save-status">{{ statusText }}</div>

    <div class="editor-picker">
      <WinTextBlock class="editor-label" :Text="t('editor.technique')" />
      <select id="tec-select" ref="tecSelectEl" class="native-select" @change="onTecChange">
        <option v-for="opt in techniqueOptions" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
      </select>
      <span id="tec-formula" ref="formulaLabelEl" class="meta"></span>
    </div>
    <p id="editor-empty" ref="emptyHintEl" class="page-note" hidden>{{ t("editor.empty") }}</p>

    <section class="editor-section">
      <WinTextBlock class="section-title" :Text="t('editor.view')" FontSize="20" FontWeight="SemiBold" />
      <div class="editor-view-tools">
        <WinTextBlock class="editor-label" :Text="t('editor.handType')" />
        <select id="view-hand" ref="handTypeSelectEl" class="native-select" @change="onHandTypeChange">
          <option v-for="opt in handTypeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <div ref="editorViewEl" id="editor-view" class="editor-view"></div>
      <WinTextBlock class="page-note" :Text="t('editor.viewHint')" />
    </section>

    <div class="editor-new">
      <input id="tec-new-name" ref="newNameEl" class="native-input" :placeholder="t('editor.newName')" />
      <select id="tec-new-formula" ref="newFormulaEl" class="native-select">
        <option v-for="opt in formulaOptions" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
      </select>
      <WinButton id="tec-new-add" :Content="t('editor.newAdd')" Style="AccentButtonStyle" @Click="onNewAdd" />
    </div>

    <section class="editor-section">
      <WinTextBlock class="section-title" :Text="t('editor.timeline')" FontSize="20" FontWeight="SemiBold" />
      <div class="tl-wrap">
        <div id="tl-ruler" class="tl-ruler" :style="{ width: tlWidth }">
          <span
            v-for="tick in rulerTicks"
            :key="tick.frame"
            :class="tick.major ? 'tl-tick-major' : 'tl-tick-minor'"
            :style="{ left: `${tick.frame * PX_PER_FRAME}px` }">
            {{ tick.major ? `${(tick.frame / 60).toFixed(1)}s` : "" }}
          </span>
        </div>
        <div id="tl-track" class="tl-track" :style="{ width: tlWidth }">
          <span
            v-for="band in stepBands"
            :key="band.stepIndex"
            class="tl-step-band"
            :style="{ left: `${band.startFrame * PX_PER_FRAME}px`, width: `${Math.max((band.endFrame - band.startFrame) * PX_PER_FRAME, 8)}px` }">
            S{{ band.stepIndex + 1 }}
          </span>
          <button
            v-for="kf in sortedKeyframes"
            :key="kf.frame"
            class="tl-kf"
            :class="{ selected: selectedFrame === kf.frame }"
            :data-frame="kf.frame"
            :style="{ left: `${kf.frame * PX_PER_FRAME - 6}px` }"
            :title="`${kf.frame} (${(kf.frame / (tech?.frameRate ?? 60)).toFixed(2)}s)`"
            @click="selectKf(kf.frame)"></button>
        </div>
      </div>
      <p id="tl-meta" ref="tlMetaEl" class="page-note"></p>
    </section>

    <section class="editor-section">
      <WinTextBlock class="section-title" :Text="t('editor.selected')" FontSize="20" FontWeight="SemiBold" />
      <div class="editor-kf-row">
        <WinTextBlock class="editor-label" :Text="t('editor.frame')" />
        <input id="kf-frame" ref="kfFrameEl" type="number" min="0" step="1" class="native-input num-input" @change="onKfFrameChange" />
        <WinTextBlock class="editor-label" :Text="t('editor.easing')" />
        <select id="kf-easing" ref="kfEasingEl" class="native-select" @change="onKfEasingChange">
          <option value="linear">linear</option>
          <option value="easeIn">easeIn</option>
          <option value="easeOut">easeOut</option>
          <option value="easeInOut">easeInOut</option>
        </select>
        <WinButton id="kf-delete" ref="kfDeleteEl" class="del" :Content="t('editor.deleteKf')" :IsEnabled="kfDeleteEnabled" @Click="onKfDelete" />
      </div>
      <pre id="kf-pose" ref="kfPoseEl" class="kf-pose"></pre>
    </section>

    <div class="editor-add">
      <WinTextBlock class="editor-label" :Text="t('editor.frame')" />
      <input id="kf-add-frame" ref="addFrameEl" type="number" min="0" step="1" class="native-input num-input" value="30" />
      <WinButton id="kf-add" :Content="t('editor.addKf')" Style="AccentButtonStyle" @Click="onKfAdd" />
    </div>
    <WinTextBlock class="page-note" :Text="t('editor.addKfHint')" />

    <section class="editor-section">
      <WinTextBlock class="section-title" :Text="t('editor.preview')" FontSize="20" FontWeight="SemiBold" />
      <div class="editor-pv-controls">
        <WinButton id="pv-play" ref="btnPlayEl" :Content="t('editor.play')" Style="AccentButtonStyle" @Click="onPvPlay" />
        <input id="pv-slider" ref="pvSliderEl" type="range" min="0" step="1" class="pv-slider" @input="onPvInput" />
        <span id="pv-readout" ref="pvReadoutEl" class="meta"></span>
      </div>
      <pre id="pv-pose" ref="pvPoseEl" class="kf-pose"></pre>
      <div class="pv-table-wrap">
        <table id="pv-table" class="pv-table">
          <template v-if="previewTableRows === null">
            <tr>
              <td>{{ t("editor.needKf") }}</td>
            </tr>
          </template>
          <template v-else>
            <tr>
              <th v-for="h in pvHeaders" :key="h">{{ h }}</th>
            </tr>
            <tr v-for="row in previewTableRows" :key="row.frame">
              <td>{{ row.frame }}</td>
              <td>{{ row.sec }}</td>
              <td>{{ row.ip }}</td>
              <td>{{ row.dip }}</td>
              <td>{{ row.contact }}</td>
            </tr>
          </template>
        </table>
      </div>
    </section>

    <WinButton id="editor-save" class="editor-save" :Content="t('editor.save')" Style="AccentButtonStyle" @Click="onSave" />
  </div>
</template>

<style>
.editor-page {
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

.section-title {
  display: block;
  margin: 22px 0 8px;
}

.editor-picker,
.editor-view-tools,
.editor-new,
.editor-kf-row,
.editor-add,
.editor-pv-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.editor-label {
  color: var(--text-secondary);
  font-size: 14px;
}

.native-input,
.native-select {
  box-sizing: border-box;
  min-height: 32px;
  padding: 4px 10px;
  border: 1px solid var(--ctrl-border);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--ctrl-fill-input-active, var(--ctrl-solid-fill));
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
}

.native-input:focus,
.native-select:focus {
  outline: 2px solid var(--accent-base);
  outline-offset: 1px;
}

.num-input {
  width: 90px;
}

.meta {
  color: var(--text-tertiary);
  font-size: 13px;
}

.editor-view {
  position: relative;
  width: 100%;
  height: 340px;
  margin-top: 8px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-solid-fill, #101014);
  overflow: hidden;
}

.tl-wrap {
  overflow-x: auto;
  padding: 6px 0;
}

.tl-ruler {
  position: relative;
  height: 22px;
  border-bottom: 1px solid var(--stroke-divider);
}

.tl-tick-major,
.tl-tick-minor {
  position: absolute;
  top: 0;
  font-size: 11px;
  color: var(--text-tertiary);
}

.tl-tick-major {
  transform: translateX(2px);
}

.tl-tick-minor {
  width: 1px;
  height: 8px;
  background: var(--ctrl-border);
}

.tl-track {
  position: relative;
  height: 34px;
}

.tl-step-band {
  position: absolute;
  top: 4px;
  height: 16px;
  border-radius: 4px;
  background: var(--accent-base);
  color: var(--accent-text);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  opacity: 0.7;
}

.tl-kf {
  position: absolute;
  top: 0;
  width: 12px;
  height: 100%;
  padding: 0;
  border: 2px solid var(--accent-base);
  border-radius: 4px;
  background: var(--ctrl-solid-fill);
  cursor: pointer;
}

.tl-kf.selected {
  background: var(--accent-base);
  outline: 2px solid var(--accent-hover);
  outline-offset: 1px;
}

.kf-pose {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--ctrl-fill-default);
  color: var(--text-primary);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.pv-slider {
  flex: 1 1 220px;
  min-width: 180px;
  accent-color: var(--accent-base);
}

.pv-table-wrap {
  margin-top: 8px;
  overflow-x: auto;
}

.pv-table {
  border-collapse: collapse;
  font-size: 13px;
}

.pv-table th,
.pv-table td {
  border: 1px solid var(--stroke-divider);
  padding: 4px 10px;
  text-align: center;
  color: var(--text-primary);
}

.pv-table th {
  background: var(--ctrl-fill-default);
  font-weight: 600;
}

.editor-save {
  margin: 22px 0 8px;
}

.page-note {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 6px;
  max-width: 720px;
}
</style>

<script setup lang="ts">
/**
 * 动画编辑器（Vue 版）：时间线/关键帧/补帧预览/3D 视口。
 * 纯时间线重映射/路径逻辑在 src/editor/timelineOps.ts，姿态工具在 src/editor/poseHelpers.ts，
 * 样式在 src/styles/editor.css；测试依赖的表单控件保持原生元素与既有 id。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import "../../styles/editor.css";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import WinToggleSwitch from "../../vendor/winui-on-web/components/WinToggleSwitch.vue";
import { CubePlayer } from "../../cube/CubePlayer";
import { GrayOverlay } from "../../cube/GrayOverlay";
import { createGrayState, presetGrayState, type GrayPreset, type GrayState } from "../../cube/stickering";
import { buildCategoryTree, flattenCategoryTree } from "../../data/category";
import { loadLibrary, saveLibrary, upsertTechniqueInLib } from "../../data/libraryStore";
import {
  createTechnique,
  removeKeyframe,
  upsertKeyframe,
  validateTechnique,
  type Easing,
  type Technique,
  type TechniqueKeyframe,
} from "../../data/technique";
import { eulerDegToQuat, poseRotationDeg, trackPoseAtFrame } from "../../editor/poseHelpers";
import {
  AUTO_PATH_STEP,
  buildAutoPathKeyframes,
  buildSinePathKeyframes,
  buildStepMappingFromMoves,
  expandFormulaMoves,
  insertTechniquePauseAfter,
  MIN_STEP_SEC,
  rebuildTechniqueWithDurations,
  rescaleTechniqueFrames,
  STEP_DEFAULT_SEC,
} from "../../editor/timelineOps";
import {
  DEFAULT_THENAR_FOLD,
  defaultHandPose,
  FINGER_ORDER,
  mirrorPose,
  type FingerName,
  type Pose,
} from "../../hand/HandRig";
import { HandRigView } from "../../hand/HandRigView";
import {
  externalDrive,
  registerHandApi,
  releaseExternalDrive,
  unregisterHandApi,
} from "../../hand/handApi";
import { bindingKey, type EditorAction } from "../../input/keymap";
import { isTextEntryTarget } from "../../input/textEntry";
import { invertMoves } from "../../notation/alg";
import { loadEditorActionKeys, loadSettings } from "../../settings";
import { DEFAULT_FRAME_RATE, interpolatePose, MAX_KEYFRAME_FRAME } from "../../timeline/Timeline";
import { renderGrayPanel } from "../../ui/grayPanel";
import { useI18n } from "../i18n";

const { t } = useI18n();

const TL_ZOOM_MIN = 0.5;
const TL_ZOOM_MAX = 16;
const SNAP_STEP = 1 / 3; // 吸附步长：1/3 块边长（sticker 网格）
const RULER_MAX_TICKS = 400;
const BEAT_MAX_TICKS = 400;
const FRAME_RATE_PRESETS = [23.97, 24, 29.97, 30, 59.94, 60, 120, 240, 1000] as const;
const PLAY_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;
// cubing experimentalAddMove 走 CatchUpHelper，1x 动画基准 = 500ms（render.md F2）
const CUBING_MOVE_SECONDS = 0.5;

const FINGER_JOINTS: Record<FingerName, string[]> = {
  thumb: ["CMC", "MCP", "IP"],
  index: ["MCP", "PIP", "DIP"],
  middle: ["MCP", "PIP", "DIP"],
  ring: ["MCP", "PIP", "DIP"],
  pinky: ["MCP", "PIP", "DIP"],
};
const FINGER_JOINT_RANGE: Record<FingerName, [number, number]> = {
  thumb: [60, 180],
  index: [90, 180],
  middle: [90, 180],
  ring: [90, 180],
  pinky: [90, 180],
};
const CMC_KEYS = ["abduction", "elevation", "rotation", "thenarFold"] as const;
const CMC_RANGE: Record<(typeof CMC_KEYS)[number], [number, number]> = {
  abduction: [-90, 90],
  elevation: [-45, 90],
  rotation: [-180, 180],
  thenarFold: [0, 90],
};

/** 时间线像素/帧（Ctrl+滚轮在 0.5~16 缩放） */
const pxPerFrame = ref(6);
const playSpeed = ref(1);
const frameBudget = MAX_KEYFRAME_FRAME;

/** 库加载结果（P0-8）：error 非 null = 整包不可读，禁止写回 */
const libLoaded = loadLibrary();
const lib = ref(libLoaded.data);
const libLoadError = ref<string | null>(libLoaded.error);
const libRejectedCount = ref(libLoaded.rejected.length);
const tech = ref<Technique | null>(null);
const isDirty = ref(false);
const playing = ref(false);
const loopPlay = ref(false);
const reversePlay = ref(false);
const previewFrame = ref(0);
const statusText = ref("");
const saveFailed = ref(false);

/** 关键帧面板「当前编辑帧」单一真相源 = previewFrame（P1-4） */
const selectedFrame = computed<number | null>({
  get: () => (tech.value ? previewFrame.value : null),
  set: (frame) => {
    if (frame === null || !Number.isFinite(frame)) return;
    previewFrame.value = frame;
  },
});

const beatFrames = computed(() => Math.round(STEP_DEFAULT_SEC * (tech.value?.frameRate ?? 60)));
const minTimelineFrames = computed(() =>
  Math.max(1, Math.round(MIN_STEP_SEC * (tech.value?.frameRate ?? DEFAULT_FRAME_RATE))),
);
const totalFrames = computed(() => {
  if (!tech.value) return 0;
  const kfLast = tech.value.keyframes.length
    ? tech.value.keyframes[tech.value.keyframes.length - 1].frame
    : 0;
  const stepLast = tech.value.stepMapping.reduce((m, s) => Math.max(m, s.endFrame), 0);
  return Math.max(kfLast, stepLast, minTimelineFrames.value);
});
const sortedKeyframes = computed(() =>
  tech.value ? [...tech.value.keyframes].sort((a, b) => a.frame - b.frame) : [],
);
const otherStepsFrames = (exclude: number | null): number => {
  const sm = tech.value?.stepMapping ?? [];
  return sm.reduce((sum, m, i) => (i === exclude ? sum : sum + (m.endFrame - m.startFrame)), 0);
};
const maxStepSec = computed(() => {
  const fr = tech.value?.frameRate ?? DEFAULT_FRAME_RATE;
  const sel = selectedSteps.value;
  const idx = sel.length === 1 ? sel[0] : null;
  return Math.max(0.1, (frameBudget - otherStepsFrames(idx)) / fr);
});
const maxBatchStepSec = computed(() => {
  const fr = tech.value?.frameRate ?? DEFAULT_FRAME_RATE;
  const n = Math.max(1, selectedSteps.value.length);
  return Math.max(0.1, (frameBudget - otherStepsFrames(null)) / (n * fr));
});
const maxBeat = computed(() => MAX_KEYFRAME_FRAME / Math.max(1, beatFrames.value));

let revApplied = 0;
let moveCursor = 0;
let lastTickAt = 0;
let frameAcc = 0;
let formulaMoves: string[] = [];
let stepMoveIndex = 0;

// DOM refs（含弯屈/CMC 输入缓存，消除播放热路径 18× getElementById）
const editorViewEl = ref<HTMLElement | null>(null);
const formulaLabelEl = ref<HTMLElement | null>(null);
const emptyHintEl = ref<HTMLElement | null>(null);
const newNameEl = ref<HTMLInputElement | null>(null);
const tlMetaEl = ref<HTMLElement | null>(null);
const kfFrameEl = ref<HTMLInputElement | null>(null);
const kfBeatEl = ref<HTMLInputElement | null>(null);
const kfEasingEl = ref<HTMLSelectElement | null>(null);
const kfPoseXEl = ref<HTMLInputElement | null>(null);
const kfPoseYEl = ref<HTMLInputElement | null>(null);
const kfPoseZEl = ref<HTMLInputElement | null>(null);
const kfPoseRxEl = ref<HTMLInputElement | null>(null);
const kfPoseRyEl = ref<HTMLInputElement | null>(null);
const kfPoseRzEl = ref<HTMLInputElement | null>(null);
const batchStepDurEl = ref<HTMLInputElement | null>(null);

const bendInputEls = new Map<string, HTMLInputElement>();
const cmcInputEls = new Map<string, HTMLInputElement>();
const setBendRef = (name: FingerName, j: number, el: unknown): void => {
  const k = `${name}-${j}`;
  if (el instanceof HTMLInputElement) bendInputEls.set(k, el);
  else bendInputEls.delete(k);
};
const setCmcRef = (key: (typeof CMC_KEYS)[number], el: unknown): void => {
  if (el instanceof HTMLInputElement) cmcInputEls.set(key, el);
  else cmcInputEls.delete(key);
};

// 侧边栏与视口状态
const tecSearch = ref("");
const formulaSearch = ref("");
const selectedFormulaId = ref("");
const snapOn = ref(true);
const grayState = ref<GrayState>(createGrayState());
const grayKind = ref<"mutable" | "immutable">("mutable");
/** 标灰小魔方默认锁定标准朝向（避免起始态逆转公式导致小魔方默认转了 U）；可切跟随魔方 */
const grayCanonical = ref(true);
const grayPanelOpen = ref(false);
const grayPanelEl = ref<HTMLElement | null>(null);
const showCube = ref(true);
const showHand = ref(true);
const showBothHands = ref(true);
/** 主位手：双手=右手主位；单手=默认左手（记住单手偏好，双↔单切换不再丢失用户选择） */
const focusHand = ref<"left" | "right">("right");
const singleHandPref = ref<"left" | "right">("left");
const maskVisible = ref(false);
const selectedSteps = ref<number[]>([]);
const kfPanelOpen = ref(false);
const kfPanelVisible = computed(() => kfPanelOpen.value);
const autoKf = ref(false);
watch(autoKf, (on) => {
  if (on) {
    kfPanelOpen.value = true;
    renderSelected(false);
  }
});

// 自定义开始态输入草稿（直输/粘贴公式 + 捕获按钮并存）
const startStateDraft = ref("");
const reverseStartDraft = ref("");
const syncStartDrafts = (): void => {
  startStateDraft.value = tech.value?.startState ?? "";
  reverseStartDraft.value = tech.value?.reverseStart ?? "";
};

const groupOpen = ref<Record<string, boolean>>({
  technique: false,
  newAdd: false,
  hand: false,
  toggle: false,
  startState: false,
  gray: false,
});
const toggleGroup = (key: string): void => {
  groupOpen.value = { ...groupOpen.value, [key]: !groupOpen.value[key] };
};
const formulaGroupOpen = ref<Record<string, boolean>>({});
const isFormulaGroupOpen = (label: string): boolean => formulaGroupOpen.value[label] === true;
const toggleFormulaGroup = (label: string): void => {
  formulaGroupOpen.value = { ...formulaGroupOpen.value, [label]: !isFormulaGroupOpen(label) };
};

let player: CubePlayer | null = null;
let handLeft: HandRigView | null = null;
let handRight: HandRigView | null = null;
let grayOverlay: GrayOverlay | null = null;
let grayPanelApi: ReturnType<typeof renderGrayPanel> | null = null;
let timer: number | null = null;
let viewIo: IntersectionObserver | null = null;
let kickTimers: number[] = [];
let maskTimer: number | null = null;
let rulerSeeking = false;

/** 用户交互接管手部：归还外部注入 API 的所有权（P1-1） */
function takeHandDrive(): void {
  releaseExternalDrive();
}

function shownFrame(): number | null {
  return tech.value ? previewFrame.value : null;
}

function lookupPose(side: "left" | "right"): { pose: Pose | null; broken: boolean } {
  return trackPoseAtFrame(sortedKeyframes.value, previewFrame.value, side);
}

function shownPose(): Pose | null {
  if (shownFrame() === null) return null;
  const side = focusHand.value === "right" ? "right" : "left";
  const r = lookupPose(side);
  if (r.pose) return r.pose;
  if (r.broken) return null;
  return side === "right" ? defaultHandPose("right") : defaultHandPose("left");
}

/** 同步姿态数值输入框（统一 renderSelected 与 renderPreview 的两套回写，消除 18× getElementById） */
function syncPoseInputs(pose: Pose | null, respectFocus: boolean): void {
  const active = respectFocus ? document.activeElement : null;
  const setVal = (el: HTMLInputElement | null | undefined, v: string): void => {
    if (el && el !== active) el.value = v;
  };
  const pos = pose?.palm.transform.position;
  const rot = pose ? poseRotationDeg(pose) : null;
  setVal(kfPoseXEl.value, pos ? pos.x.toFixed(2) : "");
  setVal(kfPoseYEl.value, pos ? pos.y.toFixed(2) : "");
  setVal(kfPoseZEl.value, pos ? pos.z.toFixed(2) : "");
  setVal(kfPoseRxEl.value, rot ? rot.x.toFixed(0) : "");
  setVal(kfPoseRyEl.value, rot ? rot.y.toFixed(0) : "");
  setVal(kfPoseRzEl.value, rot ? rot.z.toFixed(0) : "");
  for (const name of FINGER_ORDER) {
    const arr = pose?.bends[name] ?? [];
    FINGER_JOINTS[name].forEach((_, j) => {
      setVal(
        bendInputEls.get(`${name}-${j}`),
        arr[j] !== undefined ? String(Math.round(arr[j])) : "",
      );
    });
  }
  const cmc = pose?.thumbCMC;
  for (const key of CMC_KEYS) {
    const val = key === "thenarFold" ? (cmc?.thenarFold ?? DEFAULT_THENAR_FOLD) : cmc?.[key];
    setVal(cmcInputEls.get(key), cmc && val !== undefined ? String(Math.round(val)) : "");
  }
}

/** 驱动 3D 左右手实例（renderPreview 与 kickRender 共用） */
function driveHandsFromTimeline(): void {
  if (externalDrive.active) return;
  const left = lookupPose("left");
  const right = lookupPose("right");
  if (handLeft) {
    if (!showBothHands.value && focusHand.value !== "left") handLeft.setPose(null);
    else if (left.pose) handLeft.setPose(left.pose);
    else if (!left.broken) handLeft.setPose(defaultHandPose("left"));
  }
  if (handRight) {
    if (!showBothHands.value && focusHand.value !== "right") handRight.setPose(null);
    else if (right.pose) handRight.setPose(right.pose);
    else if (!right.broken) handRight.setPose(defaultHandPose("right"));
  }
}

function renderSelected(keepInputs = false): void {
  const frame = shownFrame();
  const kf = frame === null ? null : tech.value?.keyframes.find((k) => k.frame === frame);
  if (kfFrameEl.value) kfFrameEl.value.value = frame !== null ? String(frame) : "";
  if (kfBeatEl.value) kfBeatEl.value.value = beatOfSelected.value;
  if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
  if (!keepInputs) syncPoseInputs(shownPose(), false);
}

function renderPreview(): void {
  if (kfPanelVisible.value) {
    const frame = previewFrame.value;
    const kf = tech.value?.keyframes.find((k) => k.frame === frame) ?? null;
    const activeEl = document.activeElement;
    if (kfFrameEl.value && activeEl !== kfFrameEl.value) kfFrameEl.value.value = String(frame);
    if (kfBeatEl.value && activeEl !== kfBeatEl.value) kfBeatEl.value.value = beatOfSelected.value;
    if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
    const pose = shownPose();
    if (pose) syncPoseInputs(pose, true);
  }
  driveHandsFromTimeline();
}

function renderAll(keepInputs = false): void {
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
  renderSelected(keepInputs);
  renderPreview();
}

/** 同步魔方状态到目标帧：起始态 + 已执行步骤 */
const syncCubeToFrame = (frame: number): void => {
  if (!player || !tech.value) return;
  const sm = tech.value.stepMapping;
  const moves: string[] = [];
  let cursor = 0;
  for (const m of sm) {
    if (m.startFrame > frame) break;
    if (m.kind !== "pause") {
      const mv = formulaMoves[cursor];
      if (mv) moves.push(mv);
      cursor++;
    }
  }
  stepMoveIndex = sm.filter((m) => m.startFrame <= frame).length;
  moveCursor = cursor;
  const start = tech.value.startState ?? (formulaMoves.length ? invertMoves(formulaMoves.join(" ")) : "");
  player.setMoves(moves.length ? `${start} ${moves.join(" ")}` : start);
  void player.requestRender();
};

const seekFromEvent = (clientX: number, track: HTMLElement): void => {
  const rect = track.getBoundingClientRect();
  const total = Math.max(totalFrames.value, minTimelineFrames.value);
  const frame = Math.max(0, Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * total));
  previewFrame.value = Math.min(frame, total);
  takeHandDrive();
  syncCubeToFrame(previewFrame.value);
  renderSelected(true);
  renderPreview();
};

const onTrackPointerDown = (e: PointerEvent): void => {
  e.preventDefault();
  if (playing.value) playing.value = false;
  const wasOpen = kfPanelOpen.value;
  kfPanelOpen.value = true;
  const band = (e.target as HTMLElement).closest?.(".tl-step-band");
  if (band) {
    const idx = Number(band.getAttribute("data-step-index") ?? "-1");
    if (idx >= 0) selectStep(idx, e);
  } else if (selectedSteps.value.length > 0) {
    selectedSteps.value = [];
  }
  // 首次点轨道展开面板时立即刷入当前帧数值（修复陈旧值残留）
  if (!wasOpen) {
    renderSelected(false);
    renderPreview();
  }
};
const onRulerSeek = (e: PointerEvent): void => {
  e.preventDefault();
  if (playing.value) playing.value = false;
  kfPanelOpen.value = true;
  rulerSeeking = true;
  seekFromEvent(e.clientX, e.currentTarget as HTMLElement);
};
const onRulerMove = (e: PointerEvent): void => {
  if (rulerSeeking && (e.buttons & 1)) seekFromEvent(e.clientX, e.currentTarget as HTMLElement);
};
const onRulerEnd = (): void => {
  rulerSeeking = false;
};
const selectStep = (i: number, e?: MouseEvent): void => {
  if (e?.ctrlKey || e?.metaKey) {
    selectedSteps.value = selectedSteps.value.includes(i)
      ? selectedSteps.value.filter((x) => x !== i)
      : [...selectedSteps.value, i];
  } else if (e?.shiftKey && selectedSteps.value.length > 0) {
    const last = selectedSteps.value[selectedSteps.value.length - 1];
    const lo = Math.min(last, i);
    const hi = Math.max(last, i);
    const add: number[] = [];
    for (let k = lo; k <= hi; k++) if (!selectedSteps.value.includes(k)) add.push(k);
    selectedSteps.value = [...selectedSteps.value, ...add];
  } else {
    selectedSteps.value = [i];
  }
};

const stepFrames = (dir: 1 | -1, jumpKf: boolean): void => {
  if (!tech.value) return;
  if (playing.value) playing.value = false;
  const total = totalFrames.value;
  if (jumpKf && tech.value.keyframes.length > 0) {
    const frames = sortedKeyframes.value.map((k) => k.frame);
    const cur = previewFrame.value;
    if (dir > 0) {
      previewFrame.value = frames.find((f) => f > cur) ?? frames[frames.length - 1];
    } else {
      previewFrame.value = [...frames].reverse().find((f) => f < cur) ?? frames[0];
    }
  } else {
    previewFrame.value = Math.min(total, Math.max(0, previewFrame.value + dir));
  }
  takeHandDrive();
  syncCubeToFrame(previewFrame.value);
  renderSelected(true);
  renderPreview();
};

const ensureAutoKfPose = (t2: Technique, frame: number, patch: (pose: Pose) => Pose): Technique => {
  const k2 = t2.keyframes.find((k) => k.frame === frame);
  if (k2) {
    return focusHand.value === "right"
      ? upsertKeyframe(t2, { ...k2, right: patch(k2.right) })
      : upsertKeyframe(t2, { ...k2, left: patch(k2.left) });
  }
  if (!autoKf.value) return t2;
  const baseLeft = lookupPose("left").pose ?? defaultHandPose("left");
  const baseRight = lookupPose("right").pose ?? defaultHandPose("right");
  return upsertKeyframe(t2, {
    frame,
    left: focusHand.value === "left" ? patch(baseLeft) : baseLeft,
    right: focusHand.value === "right" ? patch(baseRight) : baseRight,
  });
};

/** 姿态数值编辑统一入口（合并 4 处重复前置校验） */
const editPoseAtPlayhead = (patch: (pose: Pose) => Pose): void => {
  if (!tech.value) return;
  const target = previewFrame.value;
  const hasKf = tech.value.keyframes.some((k) => k.frame === target);
  if (!hasKf && !autoKf.value) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  commit((t2) => ensureAutoKfPose(t2, target, patch), true);
};

const mirrorToOppositeAtPlayhead = (): void => {
  const frame = previewFrame.value;
  commit((t2) => {
    const k2 = t2.keyframes.find((k) => k.frame === frame);
    if (!k2) return t2;
    return focusHand.value === "left"
      ? upsertKeyframe(t2, { ...k2, right: mirrorPose(k2.left) })
      : upsertKeyframe(t2, { ...k2, left: mirrorPose(k2.right) });
  }, true);
};

const toggleShowCube = (): void => {
  showCube.value = !showCube.value;
  player?.showCube(showCube.value);
};
function applyHandVisibility(): void {
  handLeft?.setVisible(showHand.value && (showBothHands.value || focusHand.value === "left"));
  handRight?.setVisible(showHand.value && (showBothHands.value || focusHand.value === "right"));
}
const toggleShowHand = (): void => {
  showHand.value = !showHand.value;
  takeHandDrive();
  applyHandVisibility();
  renderPreview();
};
const toggleBothHands = (): void => {
  showBothHands.value = !showBothHands.value;
  // 双手默认右手主位；切回单手时恢复用户上次选定的单手偏好（默认左手）
  focusHand.value = showBothHands.value ? "right" : singleHandPref.value;
  takeHandDrive();
  applyHandVisibility();
  renderPreview();
};
const setFocusHand = (h: "left" | "right"): void => {
  focusHand.value = h;
  if (!showBothHands.value) singleHandPref.value = h;
  takeHandDrive();
  applyHandVisibility();
  renderPreview();
};

const captureStart = (which: "startState" | "reverseStart"): void => {
  if (!tech.value) {
    statusText.value = t("editor.playHint");
    return;
  }
  const algStr = player?.currentAlg ?? "";
  if (!algStr) {
    statusText.value = t("editor.captureEmpty");
    return;
  }
  if (commit((t2) => ({ ...t2, [which]: algStr }))) {
    syncStartDrafts();
    statusText.value = t("editor.startStateApplied");
  }
};

const applyCustomStartStates = (): void => {
  if (!tech.value) {
    statusText.value = t("editor.playHint");
    return;
  }
  const fwd = startStateDraft.value.trim();
  const rev = reverseStartDraft.value.trim();
  const ok = commit((t2) => ({
    ...t2,
    startState: fwd || undefined,
    reverseStart: rev || undefined,
  }));
  if (!ok) return;
  syncStartDrafts();
  if (reversePlay.value) setReverseStart();
  else setStartState();
  statusText.value = t("editor.startStateApplied");
};

const clearStartStates = (): void => {
  if (!tech.value) return;
  if (commit((t2) => ({ ...t2, startState: undefined, reverseStart: undefined }))) {
    syncStartDrafts();
    if (reversePlay.value) setReverseStart();
    else setStartState();
    statusText.value = t("editor.startStateApplied");
  }
};

const startStateLabel = computed(() => {
  const fmt = (v?: string): string => (v ? v.slice(0, 16) : t("editor.defaultLabel"));
  return `${t("editor.forward")}: ${fmt(tech.value?.startState)} ｜ ${t("editor.reverse")}: ${fmt(tech.value?.reverseStart)}`;
});

// 编辑器快捷键（含 Ctrl+S 保存，即使焦点在输入框也生效）
let spaceDownAt = 0;
let spaceCombined = false;
const editorActions = ref(loadEditorActionKeys());
function resolveEditorAction(e: KeyboardEvent): EditorAction | null {
  const k = bindingKey({ code: e.code, shift: e.shiftKey, space: false });
  for (const [action, b] of Object.entries(editorActions.value)) {
    if (bindingKey(b) === k) return action as EditorAction;
  }
  return null;
}

const onEditorKey = (e: KeyboardEvent): void => {
  if (e.type === "keydown" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    onSave();
    return;
  }
  const el = e.target as HTMLElement | null;
  if (isTextEntryTarget(el) || el?.tagName === "SELECT") return;
  const action = resolveEditorAction(e);
  if (!action) {
    if (spaceDownAt && performance.now() - spaceDownAt < 600) spaceCombined = true;
    return;
  }
  if (action === "play") {
    if (e.type === "keydown") {
      spaceDownAt = performance.now();
      spaceCombined = false;
      e.preventDefault();
    } else if (e.type === "keyup" && !spaceCombined && performance.now() - spaceDownAt < 600) {
      onPvPlay();
    }
    return;
  }
  if (e.type !== "keydown") return;
  e.preventDefault();
  switch (action) {
    case "toggle-cube":
      toggleShowCube();
      break;
    case "toggle-hand":
      toggleShowHand();
      break;
    case "toggle-both-hands":
      toggleBothHands();
      break;
    case "step-back":
      stepFrames(-1, false);
      break;
    case "step-forward":
      stepFrames(1, false);
      break;
    case "jump-prev":
      stepFrames(-1, true);
      break;
    case "jump-next":
      stepFrames(1, true);
      break;
  }
};

const rulerTicks = computed(() => {
  const fr = tech.value?.frameRate ?? 60;
  const total = totalFrames.value;
  const majorEvery = Math.max(1, Math.round(fr));
  const minorEvery = Math.max(1, Math.round(fr / 5));
  let step: number;
  let allMajor = false;
  if (total / minorEvery + 1 <= RULER_MAX_TICKS) {
    step = minorEvery;
  } else if (total / majorEvery + 1 <= RULER_MAX_TICKS) {
    step = majorEvery;
  } else {
    const ladder = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const fit = ladder.map((m) => majorEvery * m).find((c) => total / c + 1 <= RULER_MAX_TICKS);
    step = fit ?? Math.max(1, Math.ceil(total / RULER_MAX_TICKS));
    allMajor = true;
  }
  const ticks: { frame: number; major: boolean }[] = [];
  for (let f = 0; f <= total; f += step) {
    const rem = ((f % majorEvery) + majorEvery) % majorEvery;
    const major = allMajor || rem < step / 2 || rem >= majorEvery - step / 2;
    ticks.push({ frame: f, major });
  }
  return ticks;
});

const beatTicks = computed(() => {
  const ticks: { frame: number; beat: number }[] = [];
  const total = totalFrames.value;
  const beat = beatFrames.value;
  if (!Number.isFinite(beat) || beat < 1) return ticks;
  const stride = Math.max(1, Math.ceil((total / beat + 1) / BEAT_MAX_TICKS)) * beat;
  for (let f = 0; f <= total; f += stride) {
    ticks.push({ frame: f, beat: f / beat });
  }
  return ticks;
});

const beatOfSelected = computed(() => {
  const frame = shownFrame();
  return frame === null || beatFrames.value <= 0 ? "" : (frame / beatFrames.value).toFixed(2);
});

const moveEditingKeyframe = (target: number): void => {
  if (!tech.value) return;
  const src = shownFrame();
  if (src === null) return;
  if (!Number.isInteger(target) || target < 0) {
    statusText.value = t("editor.kfFail", { error: t("editor.frameInvalid") });
    renderAll();
    return;
  }
  if (target > MAX_KEYFRAME_FRAME) {
    statusText.value = t("editor.kfFail", {
      error: t("editor.frameTooLarge", { max: MAX_KEYFRAME_FRAME }),
    });
    renderAll();
    return;
  }
  const kf = tech.value.keyframes.find((k) => k.frame === src);
  if (!kf) {
    statusText.value = t("editor.kfAtFrameMissing", { frame: src });
    renderAll();
    return;
  }
  if (target === src) {
    renderAll();
    return;
  }
  if (tech.value.keyframes.some((k) => k.frame === target)) {
    statusText.value = t("editor.kfFail", { error: t("editor.frameOccupied", { frame: target }) });
    renderAll();
    return;
  }
  const prev = previewFrame.value;
  previewFrame.value = target;
  if (!commit((t2) => removeKeyframe(upsertKeyframe(t2, { ...kf, frame: target }), src))) {
    previewFrame.value = prev;
    renderAll();
    return;
  }
  syncCubeToFrame(target);
  renderAll();
};

const onKfBeatChange = (e: Event): void => {
  if (!tech.value || shownFrame() === null) return;
  const raw = (e.target as HTMLInputElement).value.trim();
  const beat = Number(raw);
  if (raw === "" || !Number.isFinite(beat) || beat < 0 || beatFrames.value < 1) {
    statusText.value = t("editor.kfFail", { error: t("editor.frameInvalid") });
    renderAll();
    return;
  }
  moveEditingKeyframe(Math.round(beat * beatFrames.value));
};

const onFrameRateChange = (e: Event): void => {
  if (!tech.value) return;
  const select = e.target as HTMLSelectElement;
  const fr = Number(select.value);
  if (!Number.isFinite(fr) || fr <= 0) {
    renderAll();
    return;
  }
  const oldFr = tech.value.frameRate;
  if (oldFr === fr) return;
  playing.value = false;
  const pv = previewFrame.value;
  if (
    !commit((t2) =>
      rescaleTechniqueFrames(t2, oldFr, fr, (a, b, f) => t("editor.rescaleCollide", { a, b, f })),
    )
  ) {
    select.value = String(oldFr);
    renderAll();
    return;
  }
  previewFrame.value = Math.round((pv / oldFr) * fr);
  syncCubeToFrame(previewFrame.value);
  renderAll();
};

const tlWidth = computed(() => `${Math.max(totalFrames.value, minTimelineFrames.value) * pxPerFrame.value}px`);
const stepBands = computed(() => tech.value?.stepMapping ?? []);
const kfDeleteEnabled = computed(
  () => shownFrame() !== null && !!tech.value?.keyframes.find((k) => k.frame === shownFrame()),
);

const filteredTechniques = computed(() => {
  const q = tecSearch.value.trim().toLowerCase();
  if (!q) return lib.value.techniques;
  return lib.value.techniques.filter((x) => {
    if (x.name.toLowerCase().includes(q)) return true;
    const f = lib.value.formulas.find((fm) => fm.id === x.formulaId);
    return !!f?.name.toLowerCase().includes(q);
  });
});

const filteredNewFormulas = computed(() => {
  const q = formulaSearch.value.trim().toLowerCase();
  if (!q) return lib.value.formulas;
  return lib.value.formulas.filter(
    (f) => f.name.toLowerCase().includes(q) || f.moves.toLowerCase().includes(q),
  );
});

const formulaGroupRows = computed(() => {
  const nodes = buildCategoryTree(
    lib.value.categories,
    filteredNewFormulas.value,
    (f) => f.categoryId,
    t("editor.formulaNone"),
  );
  return flattenCategoryTree(nodes, isFormulaGroupOpen, (f) => f.id);
});

function selectTech(id: string): void {
  playing.value = false;
  previewFrame.value = 0;
  kfPanelOpen.value = false;
  selectedSteps.value = [];
  tech.value = lib.value.techniques.find((x) => x.id === id) ?? null;
  computeFormulaMoves();
  if (tech.value && tech.value.stepMapping.length === 0 && formulaMoves.length > 0) {
    tech.value = {
      ...tech.value,
      stepMapping: buildStepMappingFromMoves(formulaMoves, tech.value.frameRate, frameBudget),
    };
  }
  stepMoveIndex = 0;
  moveCursor = 0;
  revApplied = tech.value?.stepMapping.length ?? formulaMoves.length;
  syncStartDrafts();
  setStartState();
  renderAll();
}

function setStartState(): void {
  if (!player) return;
  player.setMoves(
    tech.value?.startState ?? (formulaMoves.length ? invertMoves(formulaMoves.join(" ")) : ""),
  );
}

function setReverseStart(): void {
  if (!player) return;
  player.setMoves(tech.value?.reverseStart ?? "");
}

function computeFormulaMoves(): void {
  formulaMoves = [];
  if (!tech.value) return;
  const f = lib.value.formulas.find((x) => x.id === tech.value!.formulaId);
  if (!f) return;
  formulaMoves = expandFormulaMoves(f.moves);
}

function syncStepSpeed(): void {
  if (!tech.value) return;
  const m0 = tech.value.stepMapping[0];
  if (!m0) return;
  const stepSec = (m0.endFrame - m0.startFrame) / tech.value.frameRate;
  if (stepSec > 0) player?.setSpeed((CUBING_MOVE_SECONDS / stepSec) * playSpeed.value);
}

const onPlaySpeedChange = (e: Event): void => {
  const v = Number((e.target as HTMLSelectElement).value);
  if (!Number.isFinite(v) || v <= 0) {
    renderAll();
    return;
  }
  playSpeed.value = v;
  if (playing.value) syncStepSpeed();
};

function safeApplyMove(move: string): void {
  try {
    player?.applyMove(move);
  } catch {
    // 异常记法不拖垮 60Hz 播放循环
  }
}

function applyStepAtFrame(frame: number): void {
  if (!tech.value) return;
  for (const m of tech.value.stepMapping) {
    if (m.stepIndex !== stepMoveIndex) continue;
    if (frame < m.startFrame) break;
    if (m.kind === "pause") {
      stepMoveIndex++;
      continue;
    }
    const move = formulaMoves[moveCursor];
    if (move) safeApplyMove(move);
    moveCursor++;
    stepMoveIndex++;
  }
}

/** 统一提交入口（P0-9）：校验→停止播放→同步内存库与游标→标脏→刷新 */
function commit(fn: (t2: Technique) => Technique, keepInputs = false): boolean {
  if (!tech.value) return false;
  takeHandDrive();
  try {
    const next = fn(tech.value);
    validateTechnique(next);
    if (playing.value) playing.value = false;
    tech.value = next;
    lib.value = upsertTechniqueInLib(lib.value, next);
    isDirty.value = true;
    computeFormulaMoves();
    stepMoveIndex = 0;
    moveCursor = 0;
    revApplied = next.stepMapping.length;
    renderAll(keepInputs);
    return true;
  } catch (e) {
    statusText.value = t("editor.kfFail", { error: e instanceof Error ? e.message : String(e) });
    renderAll(keepInputs);
    return false;
  }
}

const onNewAdd = (): void => {
  const name = newNameEl.value?.value.trim() ?? "";
  const formulaId = selectedFormulaId.value;
  if (!name) {
    statusText.value = t("editor.newFail");
    return;
  }
  if (!formulaId) {
    statusText.value = t("editor.newFailFormula");
    return;
  }
  if (!canPersistLibrary()) return;
  const created = createTechnique({ name, formulaId });
  lib.value = upsertTechniqueInLib(lib.value, created);
  saveLibrary(lib.value);
  isDirty.value = false;
  if (newNameEl.value) newNameEl.value.value = "";
  selectTech(created.id);
  statusText.value = t("editor.saved");
};

const onKfFrameChange = (e: Event): void => {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (raw === "") {
    statusText.value = t("editor.kfFail", { error: t("editor.frameInvalid") });
    renderAll();
    return;
  }
  moveEditingKeyframe(Number(raw));
};

const onKfEasingChange = (e: Event): void => {
  const frame = shownFrame();
  if (!tech.value || frame === null) return;
  const easing = (e.target as HTMLSelectElement).value as Easing;
  const kf = tech.value.keyframes.find((k) => k.frame === frame);
  if (!kf) {
    statusText.value = t("editor.easingNeedKf", { frame });
    renderAll();
    return;
  }
  commit((t2) => upsertKeyframe(t2, { ...kf, easing }));
};

const onKfDelete = (): void => {
  const frame = shownFrame();
  if (!tech.value || frame === null) return;
  if (!commit((t2) => removeKeyframe(t2, frame))) return;
  renderAll();
};

const onPoseInput = (e: Event, axis: "x" | "y" | "z"): void => {
  let v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  if (snapOn.value) v = Math.round(v / SNAP_STEP) * SNAP_STEP;
  editPoseAtPlayhead((pose) => ({
    ...pose,
    palm: {
      ...pose.palm,
      transform: {
        ...pose.palm.transform,
        position: { ...pose.palm.transform.position, [axis]: v },
      },
    },
  }));
};

const onPoseRotInput = (): void => {
  const rx = Number(kfPoseRxEl.value?.value ?? "0");
  const ry = Number(kfPoseRyEl.value?.value ?? "0");
  const rz = Number(kfPoseRzEl.value?.value ?? "0");
  if (![rx, ry, rz].every((v) => Number.isFinite(v))) return;
  const quat = eulerDegToQuat(rx, ry, rz);
  editPoseAtPlayhead((pose) => ({
    ...pose,
    palm: {
      ...pose.palm,
      transform: { ...pose.palm.transform, quaternion: quat },
    },
  }));
};

const onBendInput = (e: Event, name: FingerName, j: number): void => {
  let v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  const [lo, hi] = FINGER_JOINT_RANGE[name];
  v = Math.min(hi, Math.max(lo, v));
  editPoseAtPlayhead((pose) => {
    const arr = [...(pose.bends[name] ?? [])];
    arr[j] = v;
    return { ...pose, bends: { ...pose.bends, [name]: arr } };
  });
};

const onThumbCmcInput = (e: Event, key: (typeof CMC_KEYS)[number]): void => {
  const v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  const [lo, hi] = CMC_RANGE[key];
  const clamped = Math.min(hi, Math.max(lo, v));
  editPoseAtPlayhead((pose) => ({
    ...pose,
    thumbCMC: { ...pose.thumbCMC, [key]: clamped },
  }));
};

const onKfAdd = (): void => {
  if (!tech.value) return;
  const target = previewFrame.value;
  commit((t2) => {
    if (t2.keyframes.some((k) => k.frame === target)) return t2;
    const sorted = [...t2.keyframes].sort((a, b) => a.frame - b.frame);
    let src: TechniqueKeyframe | undefined;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].frame < target) {
        src = sorted[i];
        break;
      }
    }
    if (src) return upsertKeyframe(t2, { frame: target, left: src.left, right: src.right });
    return upsertKeyframe(t2, {
      frame: target,
      left: defaultHandPose("left"),
      right: defaultHandPose("right"),
    });
  });
  renderAll();
};

const onPvPlay = (): void => {
  if (!tech.value) {
    maskVisible.value = true;
    if (maskTimer !== null) clearTimeout(maskTimer);
    maskTimer = window.setTimeout(() => (maskVisible.value = false), 2600);
    return;
  }
  takeHandDrive();
  if (!playing.value) {
    computeFormulaMoves();
    syncStepSpeed();
    if (reversePlay.value) {
      if (previewFrame.value >= totalFrames.value || previewFrame.value <= 0) {
        setReverseStart();
        previewFrame.value = totalFrames.value;
        stepMoveIndex = 0;
        moveCursor = 0;
        revApplied = tech.value.stepMapping.length;
      }
    } else {
      if (previewFrame.value <= 0 || previewFrame.value >= totalFrames.value) {
        setStartState();
        previewFrame.value = 0;
        stepMoveIndex = 0;
        moveCursor = 0;
      }
    }
    lastTickAt = 0;
    frameAcc = 0;
  }
  playing.value = !playing.value;
};

watch([loopPlay, reversePlay], () => {
  if (!playing.value) return;
  playing.value = false;
  stepMoveIndex = 0;
  moveCursor = 0;
  revApplied = tech.value?.stepMapping.length ?? 0;
  previewFrame.value = 0;
  lastTickAt = 0;
  frameAcc = 0;
  if (reversePlay.value) setReverseStart();
  else setStartState();
  renderPreview();
});

const stepDurationText = (idx: number): string => {
  const m = tech.value?.stepMapping[idx];
  const fr = tech.value?.frameRate ?? DEFAULT_FRAME_RATE;
  return m ? ((m.endFrame - m.startFrame) / fr).toFixed(2) : "";
};

const onStepDurationChange = (e: Event, idx: number): void => {
  if (!tech.value) return;
  const input = e.target as HTMLInputElement;
  const sec = Number(input.value);
  if (!Number.isFinite(sec) || sec <= 0) {
    input.value = stepDurationText(idx);
    renderAll();
    return;
  }
  const maxSec = maxStepSec.value;
  if (sec > maxSec) {
    statusText.value = t("editor.stepDurationTooLong", {
      sec,
      max: maxSec.toFixed(1),
      maxFrame: MAX_KEYFRAME_FRAME,
    });
    input.value = stepDurationText(idx);
    renderAll();
    return;
  }
  const ok = commit((t2) =>
    rebuildTechniqueWithDurations(
      t2,
      (i) => (i === idx ? sec : (t2.stepMapping[i].endFrame - t2.stepMapping[i].startFrame) / t2.frameRate),
      (a, b, f) => t("editor.remapCollide", { a, b, f }),
    ),
  );
  if (!ok) input.value = stepDurationText(idx);
};

const onBatchApply = (): void => {
  if (!tech.value || selectedSteps.value.length < 2) return;
  const sec = Number(batchStepDurEl.value?.value);
  if (!Number.isFinite(sec) || sec <= 0) {
    renderAll();
    return;
  }
  const maxSec = maxBatchStepSec.value;
  if (sec > maxSec) {
    statusText.value = t("editor.stepDurationTooLong", {
      sec,
      max: maxSec.toFixed(1),
      maxFrame: MAX_KEYFRAME_FRAME,
    });
    return;
  }
  const sel = new Set(selectedSteps.value);
  commit((t2) =>
    rebuildTechniqueWithDurations(
      t2,
      (i) => (sel.has(i) ? sec : (t2.stepMapping[i].endFrame - t2.stepMapping[i].startFrame) / t2.frameRate),
      (a, b, f) => t("editor.remapCollide", { a, b, f }),
    ),
  );
};

const insertPauseAfter = (): void => {
  if (!tech.value || selectedSteps.value.length !== 1) return;
  const idx = selectedSteps.value[0];
  commit((t2) =>
    insertTechniquePauseAfter(t2, idx, STEP_DEFAULT_SEC, (a, b, f) =>
      t("editor.remapCollide", { a, b, f }),
    ),
  );
};

const onTlWheel = (e: WheelEvent): void => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  pxPerFrame.value = Math.min(TL_ZOOM_MAX, Math.max(TL_ZOOM_MIN, pxPerFrame.value * factor));
};

function canPersistLibrary(): boolean {
  if (libLoadError.value === null) return true;
  statusText.value = t("editor.libSaveBlocked");
  saveFailed.value = true;
  return false;
}

const onSave = (): void => {
  if (!tech.value) return;
  if (!canPersistLibrary()) return;
  try {
    lib.value = upsertTechniqueInLib(lib.value, tech.value);
    saveLibrary(lib.value);
    isDirty.value = false;
    statusText.value = t("editor.saved");
    saveFailed.value = false;
  } catch (e) {
    statusText.value = t("editor.saveFail", { error: e instanceof Error ? e.message : String(e) });
    saveFailed.value = true;
  }
};

const onAutoPath = (): void => {
  if (!tech.value) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  const nextKfs = buildAutoPathKeyframes(tech.value.keyframes, AUTO_PATH_STEP);
  if (!nextKfs) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  if (commit((t2) => ({ ...t2, keyframes: nextKfs }))) {
    statusText.value = t("editor.autoPathDone");
  }
};

const onInsertMid = (): void => {
  if (!tech.value || selectedFrame.value === null) {
    statusText.value = t("editor.insertMidNeed");
    return;
  }
  const sorted = sortedKeyframes.value;
  const idx = sorted.findIndex((k) => k.frame === selectedFrame.value);
  if (idx < 0 || idx >= sorted.length - 1) {
    statusText.value = t("editor.insertMidNeed");
    return;
  }
  const a = sorted[idx];
  const b = sorted[idx + 1];
  const mid = Math.round((a.frame + b.frame) / 2);
  if (mid <= a.frame || mid >= b.frame) {
    statusText.value = t("editor.insertMidNeed");
    return;
  }
  const u = (mid - a.frame) / (b.frame - a.frame);
  if (
    commit((t2) =>
      upsertKeyframe(t2, {
        frame: mid,
        left: interpolatePose(a.left, b.left, u),
        right: interpolatePose(a.right, b.right, u),
        easing: a.easing ?? "linear",
      }),
    )
  ) {
    statusText.value = t("editor.insertMidDone");
  }
};

const onSinePath = (): void => {
  if (!tech.value) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  const nextKfs = buildSinePathKeyframes(tech.value.keyframes, AUTO_PATH_STEP);
  if (!nextKfs) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  if (commit((t2) => ({ ...t2, keyframes: nextKfs }))) {
    statusText.value = t("editor.sinePathDone");
  }
};

const toggleGrayPanel = (): void => {
  grayPanelOpen.value = !grayPanelOpen.value;
  if (!grayPanelOpen.value || !grayPanelEl.value) return;
  if (grayPanelApi) {
    grayPanelApi.refresh();
    return;
  }
  grayOverlay?.setRenderListener(() => grayPanelApi?.refresh());
  grayPanelApi = renderGrayPanel(grayPanelEl.value, {
    getState: () => grayState.value,
    setState: (s) => {
      grayState.value = s;
      grayOverlay?.requestApply(s);
      grayPanelApi?.refresh();
    },
    getBase: () => loadSettings().baseFace,
    getKind: () => grayKind.value,
    getPositions: () => grayOverlay?.currentPositions() ?? new Map(),
    isVisible: () => grayPanelOpen.value,
    canonicalView: () => grayCanonical.value,
    applyPreset: (p: GrayPreset | "clear") => {
      grayState.value = p === "clear" ? createGrayState() : presetGrayState(p, loadSettings().baseFace);
      grayOverlay?.requestApply(grayState.value);
      grayPanelApi?.refresh();
    },
  });
};

const onToggleGrayGroup = (): void => {
  toggleGroup("gray");
  toggleGrayPanel();
};
const toggleGrayKind = (): void => {
  grayKind.value = grayKind.value === "mutable" ? "immutable" : "mutable";
};
const toggleGrayCanonical = (): void => {
  grayCanonical.value = !grayCanonical.value;
  grayPanelApi?.refresh();
};

const selectKf = (frame: number): void => {
  selectedFrame.value = frame;
  kfPanelOpen.value = true;
  takeHandDrive();
  syncCubeToFrame(frame);
  renderAll();
};

onMounted(() => {
  if (!editorViewEl.value) return;
  player = new CubePlayer(editorViewEl.value, {
    cameraDistance: 8,
    baseFace: loadSettings().baseFace,
  });
  handLeft = new HandRigView(player, "left");
  void handLeft.init();
  handRight = new HandRigView(player, "right");
  void handRight.init();
  applyHandVisibility();
  grayOverlay = new GrayOverlay(player);
  void grayOverlay.init().then(() => grayOverlay?.requestApply(grayState.value));
  window.addEventListener("keydown", onEditorKey);
  window.addEventListener("keyup", onEditorKey);
  (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor = { player, handLeft, handRight };
  registerHandApi(handLeft, handRight ?? undefined);
  renderAll();
  if (libLoadError.value !== null) {
    statusText.value = t("editor.libLoadError", { error: libLoadError.value });
    saveFailed.value = true;
  } else if (libRejectedCount.value > 0) {
    statusText.value = t("editor.libLoadSkipped", { n: libRejectedCount.value });
  }
  const kickRender = (): void => {
    void (async () => {
      try {
        await player?.requestRender();
      } catch {
        // 场景未就绪时忽略
      }
      driveHandsFromTimeline();
    })();
  };
  viewIo = new IntersectionObserver(
    (entries) => {
      if (entries.some((en) => en.isIntersecting)) kickRender();
    },
    { threshold: 0.01 },
  );
  if (editorViewEl.value) viewIo.observe(editorViewEl.value);
  kickTimers = [1200, 3500, 8000].map((ms) => window.setTimeout(kickRender, ms));
  timer = window.setInterval(() => {
    if (!playing.value || !tech.value) {
      lastTickAt = 0;
      frameAcc = 0;
      return;
    }
    const now = performance.now();
    const dtSec = lastTickAt ? (now - lastTickAt) / 1000 : 1 / 60;
    lastTickAt = now;
    frameAcc += dtSec * tech.value.frameRate * playSpeed.value;
    const advFrames = Math.floor(frameAcc);
    frameAcc -= advFrames;
    const total = totalFrames.value;
    if (reversePlay.value) {
      if (previewFrame.value <= 0) {
        if (loopPlay.value) {
          previewFrame.value = total;
          setReverseStart();
          stepMoveIndex = 0;
          moveCursor = 0;
          revApplied = tech.value.stepMapping.length;
        } else {
          playing.value = false;
        }
      } else {
        previewFrame.value -= advFrames;
      }
      if (!playing.value) {
        renderPreview();
        return;
      }
      const sm = tech.value.stepMapping;
      for (let i = sm.length - 1; i >= 0; i--) {
        const m = sm[i];
        if (revApplied > i && previewFrame.value >= m.startFrame && previewFrame.value < m.endFrame) {
          if (m.kind !== "pause") {
            const moveCount = sm.slice(0, i + 1).filter((x) => x.kind !== "pause").length;
            const move = formulaMoves[moveCount - 1];
            if (move) safeApplyMove(invertMoves(move));
          }
          revApplied = i;
          break;
        }
      }
    } else {
      if (previewFrame.value >= total) {
        if (loopPlay.value) {
          previewFrame.value = 0;
          stepMoveIndex = 0;
          moveCursor = 0;
          setStartState();
        } else {
          playing.value = false;
        }
      } else {
        previewFrame.value += advFrames;
      }
      if (!playing.value) {
        renderPreview();
        return;
      }
      applyStepAtFrame(previewFrame.value);
    }
    renderPreview();
  }, 1000 / 60);
});

onBeforeUnmount(() => {
  if (timer !== null) window.clearInterval(timer);
  if (maskTimer !== null) window.clearTimeout(maskTimer);
  maskTimer = null;
  viewIo?.disconnect();
  viewIo = null;
  kickTimers.forEach((id) => window.clearTimeout(id));
  kickTimers = [];
  window.removeEventListener("keydown", onEditorKey);
  window.removeEventListener("keyup", onEditorKey);
  editorViewEl.value?.replaceChildren();
  delete (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor;
  releaseExternalDrive();
  unregisterHandApi();
  grayPanelApi?.dispose();
  grayPanelApi = null;
  grayOverlay?.dispose();
  grayOverlay = null;
  handLeft?.dispose();
  handLeft = null;
  handRight?.dispose();
  handRight = null;
  player?.dispose();
  player = null;
});
</script>

<template>
  <div class="editor-page">
    <div class="editor-layout">
      <!-- 左侧侧边栏（PS 风格）：关键帧 / 手法 / 新建 / 显隐 / 起始态 / 标灰 -->
      <aside class="editor-sidebar">
        <div v-show="kfPanelVisible" id="kf-edit-panel" class="kf-edit-panel sb-kf-panel">
          <div class="kf-edit-head">
            <WinTextBlock class="editor-label" :Text="t('editor.kfEdit')" FontSize="12" />
            <WinButton id="kf-panel-close" :Content="t('editor.stepDone')" @Click="kfPanelOpen = false" />
          </div>
          <div class="editor-kf-row">
            <WinTextBlock class="editor-label" :Text="t('editor.editHand')" />
            <button
              id="kf-edit-hand-left"
              class="zoom-btn"
              :class="{ on: focusHand === 'left' }"
              @click="setFocusHand('left')">{{ t("editor.handLeft") }}</button>
            <button
              id="kf-edit-hand-right"
              class="zoom-btn"
              :class="{ on: focusHand === 'right' }"
              @click="setFocusHand('right')">{{ t("editor.handRight") }}</button>
            <button
              id="kf-mirror-to-other"
              class="zoom-btn"
              :title="t('editor.mirrorToOtherHint')"
              @click="mirrorToOppositeAtPlayhead">{{ t("editor.mirrorToOther") }}</button>
          </div>
          <div class="editor-kf-row">
            <WinTextBlock class="editor-label" :Text="t('editor.frame')" />
            <input id="kf-frame" ref="kfFrameEl" type="number" min="0" :max="MAX_KEYFRAME_FRAME" step="1" class="native-input num-input" @change="onKfFrameChange" />
            <WinTextBlock class="editor-label" :Text="t('editor.beat')" />
            <input id="kf-frame-beat" ref="kfBeatEl" type="number" min="0" :max="maxBeat" step="0.01" class="native-input num-input" @change="onKfBeatChange" />
            <WinTextBlock class="editor-label" :Text="t('editor.easing')" />
            <select id="kf-easing" ref="kfEasingEl" class="native-select" @change="onKfEasingChange">
              <option value="linear">linear</option>
              <option value="easeIn">easeIn</option>
              <option value="easeOut">easeOut</option>
              <option value="easeInOut">easeInOut</option>
            </select>
            <WinButton id="kf-delete" class="del" :Content="t('editor.deleteKf')" :IsEnabled="kfDeleteEnabled" @Click="onKfDelete" />
          </div>
          <div class="kf-add-tools">
            <WinButton id="kf-add" :Content="t('editor.addKf')" Style="AccentButtonStyle" @Click="onKfAdd" />
            <WinButton id="auto-path" :Content="t('editor.autoPath')" @Click="onAutoPath" />
            <WinButton id="kf-insert-mid" :Content="t('editor.insertMid')" @Click="onInsertMid" />
            <WinButton id="sine-path" :Content="t('editor.sinePath')" @Click="onSinePath" />
          </div>
          <div class="pose-edit">
            <div class="pose-edit-row">
              <WinToggleSwitch v-model:IsOn="snapOn" :OnContent="t('editor.snapOn')" :OffContent="t('editor.snapOff')" />
            </div>
            <div class="pose-edit-row">
              <WinTextBlock class="editor-label" :Text="t('editor.pose')" FontSize="12" />
              <label class="pose-axis">
                {{ t("editor.posX") }}
                <input id="kf-pose-x" ref="kfPoseXEl" type="number" step="0.05" class="native-input num-input" @input="onPoseInput($event, 'x')" />
              </label>
              <label class="pose-axis">
                {{ t("editor.posY") }}
                <input id="kf-pose-y" ref="kfPoseYEl" type="number" step="0.05" class="native-input num-input" @input="onPoseInput($event, 'y')" />
              </label>
              <label class="pose-axis">
                {{ t("editor.posZ") }}
                <input id="kf-pose-z" ref="kfPoseZEl" type="number" step="0.05" class="native-input num-input" @input="onPoseInput($event, 'z')" />
              </label>
            </div>
            <div class="pose-edit-row">
              <WinTextBlock class="editor-label" :Text="t('editor.poseRot')" FontSize="12" />
              <label class="pose-axis">
                {{ t("editor.posRx") }}
                <input id="kf-pose-rx" ref="kfPoseRxEl" type="number" step="1" class="native-input num-input" @input="onPoseRotInput" />
              </label>
              <label class="pose-axis">
                {{ t("editor.posRy") }}
                <input id="kf-pose-ry" ref="kfPoseRyEl" type="number" step="1" class="native-input num-input" @input="onPoseRotInput" />
              </label>
              <label class="pose-axis">
                {{ t("editor.posRz") }}
                <input id="kf-pose-rz" ref="kfPoseRzEl" type="number" step="1" class="native-input num-input" @input="onPoseRotInput" />
              </label>
            </div>
            <div class="pose-edit-row">
              <WinTextBlock class="editor-label" :Text="t('editor.thumbCmc')" FontSize="12" />
              <label class="pose-axis">
                {{ t("hand.cmcAbduction") }}
                <input
                  id="kf-cmc-abduction"
                  :ref="(el) => setCmcRef('abduction', el)"
                  type="number"
                  step="1"
                  min="-90"
                  max="90"
                  class="native-input num-input"
                  @input="onThumbCmcInput($event, 'abduction')" />
              </label>
              <label class="pose-axis">
                {{ t("hand.cmcElevation") }}
                <input
                  id="kf-cmc-elevation"
                  :ref="(el) => setCmcRef('elevation', el)"
                  type="number"
                  step="1"
                  min="-45"
                  max="90"
                  class="native-input num-input"
                  @input="onThumbCmcInput($event, 'elevation')" />
              </label>
              <label class="pose-axis">
                {{ t("hand.cmcRotation") }}
                <input
                  id="kf-cmc-rotation"
                  :ref="(el) => setCmcRef('rotation', el)"
                  type="number"
                  step="1"
                  min="-180"
                  max="180"
                  class="native-input num-input"
                  @input="onThumbCmcInput($event, 'rotation')" />
              </label>
              <label class="pose-axis">
                {{ t("hand.thenarFold") }}
                <input
                  id="kf-cmc-thenarFold"
                  :ref="(el) => setCmcRef('thenarFold', el)"
                  type="number"
                  step="1"
                  min="0"
                  max="90"
                  class="native-input num-input"
                  @input="onThumbCmcInput($event, 'thenarFold')" />
              </label>
            </div>
            <div class="finger-joints">
              <WinTextBlock class="editor-label" :Text="t('editor.fingers')" FontSize="12" />
              <div v-for="name in FINGER_ORDER" :key="name" class="finger-row">
                <span class="finger-name">{{ t(`hand.finger${name[0].toUpperCase()}${name.slice(1)}`) }}</span>
                <label v-for="(jname, j) in FINGER_JOINTS[name]" :key="j" class="pose-axis">
                  {{ jname }}
                  <input
                    :id="`kf-bend-${name}-${j}`"
                    :ref="(el) => setBendRef(name, j, el)"
                    type="number"
                    :min="FINGER_JOINT_RANGE[name][0]"
                    :max="FINGER_JOINT_RANGE[name][1]"
                    step="1"
                    class="native-input num-input"
                    @input="onBendInput($event, name, j)" />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div class="sb-group">
          <button class="sb-group-head" @click="toggleGroup('technique')">
            <span>{{ t("editor.technique") }}</span>
            <span class="sb-group-caret">{{ groupOpen.technique ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.technique" class="sb-group-body">
            <input id="tec-search" v-model="tecSearch" class="native-input" :placeholder="t('editor.tecSearch')" />
            <div class="tec-list">
              <button
                v-for="item in filteredTechniques"
                :key="item.id"
                class="tec-item"
                :class="{ active: tech?.id === item.id }"
                @click="selectTech(item.id)">{{ item.name }}</button>
              <p v-if="filteredTechniques.length === 0" class="meta list-empty">{{ t("editor.searchEmpty") }}</p>
            </div>
            <span id="tec-formula" ref="formulaLabelEl" class="meta"></span>
            <p id="editor-empty" ref="emptyHintEl" class="page-note" hidden>{{ t("editor.empty") }}</p>
            <p v-if="libLoadError" id="editor-lib-error" class="page-note lib-warn">
              {{ t("editor.libLoadError", { error: libLoadError }) }}
            </p>
            <p v-else-if="libRejectedCount > 0" id="editor-lib-skipped" class="page-note lib-warn">
              {{ t("editor.libLoadSkipped", { n: libRejectedCount }) }}
            </p>
          </div>
        </div>

        <div class="sb-group">
          <button class="sb-group-head" @click="toggleGroup('newAdd')">
            <span>{{ t("editor.newAdd") }}</span>
            <span class="sb-group-caret">{{ groupOpen.newAdd ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.newAdd" class="sb-group-body">
            <input id="tec-new-name" ref="newNameEl" class="native-input" :placeholder="t('editor.newName')" />
            <input id="new-formula-search" v-model="formulaSearch" class="native-input" :placeholder="t('editor.formulaSearch')" />
            <div class="formula-list">
              <template v-for="row in formulaGroupRows" :key="`${row.kind}-${row.id}`">
                <button
                  v-if="row.kind === 'group'"
                  class="formula-group-label"
                  :style="{ paddingLeft: `${10 + row.depth * 14}px` }"
                  @click="toggleFormulaGroup(row.id)">
                  <span>{{ row.label }}</span>
                  <span class="sb-group-caret">{{ isFormulaGroupOpen(row.id) ? "\u25BE" : "\u25B8" }}</span>
                </button>
                <button
                  v-else
                  class="tec-item"
                  :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                  :class="{ active: selectedFormulaId === row.id }"
                  @click="selectedFormulaId = row.id">{{ row.item.name }}</button>
              </template>
              <p v-if="formulaGroupRows.length === 0" class="meta list-empty">{{ t("editor.searchEmpty") }}</p>
            </div>
            <WinButton id="tec-new-add" :Content="t('editor.newAdd')" Style="AccentButtonStyle" @Click="onNewAdd" />
          </div>
        </div>

        <div class="sb-group">
          <button class="sb-group-head" @click="toggleGroup('toggle')">
            <span>{{ t("editor.viewToggle") }}</span>
            <span class="sb-group-caret">{{ groupOpen.toggle ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.toggle" class="sb-group-body">
            <WinButton id="editor-toggle-cube" :Content="showCube ? t('editor.hideCube') : t('editor.showCube')" @Click="toggleShowCube" />
            <WinButton id="editor-toggle-hand" :Content="showHand ? t('editor.hideHand') : t('editor.showHand')" @Click="toggleShowHand" />
            <WinButton id="editor-toggle-both-hands" :Content="showBothHands ? t('editor.hideBothHands') : t('editor.showBothHands')" @Click="toggleBothHands" />
            <WinTextBlock class="page-note" :Text="t('editor.toggleHint')" FontSize="11" />
          </div>
        </div>

        <div class="sb-group">
          <button class="sb-group-head" @click="toggleGroup('startState')">
            <span>{{ t("editor.startState") }}</span>
            <span class="sb-group-caret">{{ groupOpen.startState ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.startState" class="sb-group-body">
            <div class="start-state-form">
              <label class="start-state-label">
                <span>{{ t("editor.forward") }}</span>
                <input
                  id="input-start-state"
                  v-model="startStateDraft"
                  class="native-input"
                  :placeholder="t('editor.startStateInput')"
                  @keydown.enter.prevent="applyCustomStartStates" />
              </label>
              <label class="start-state-label">
                <span>{{ t("editor.reverse") }}</span>
                <input
                  id="input-reverse-start"
                  v-model="reverseStartDraft"
                  class="native-input"
                  :placeholder="t('editor.reverseStartInput')"
                  @keydown.enter.prevent="applyCustomStartStates" />
              </label>
              <WinButton id="apply-start-state" :Content="t('editor.applyStart')" Style="AccentButtonStyle" @Click="applyCustomStartStates" />
            </div>
            <WinButton id="capture-start" :Content="t('editor.captureStart')" @Click="captureStart('startState')" />
            <WinButton id="capture-reverse" :Content="t('editor.captureReverse')" @Click="captureStart('reverseStart')" />
            <WinButton id="clear-start" :Content="t('editor.clearStart')" @Click="clearStartStates" />
            <span class="meta">{{ startStateLabel }}</span>
          </div>
        </div>

        <div class="sb-group">
          <button class="sb-group-head" @click="onToggleGrayGroup">
            <span>{{ t("gray.btn") }}</span>
            <span class="sb-group-caret">{{ groupOpen.gray ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.gray" class="sb-group-body">
            <div v-show="grayPanelOpen" class="editor-gray-panel">
              <div class="editor-gray-kind-row">
                <WinTextBlock class="editor-label" :Text="t('gray.title')" FontSize="12" />
                <WinToggleSwitch
                  class="editor-gray-kind-toggle"
                  :IsOn="grayKind === 'immutable'"
                  :OnContent="t('gray.kind.immutable')"
                  :OffContent="t('gray.kind.mutable')"
                  @Toggled="toggleGrayKind" />
                <WinToggleSwitch
                  id="editor-gray-canonical-toggle"
                  class="editor-gray-canonical-toggle"
                  :IsOn="grayCanonical"
                  :OnContent="t('gray.view.canonical')"
                  :OffContent="t('gray.view.live')"
                  @Toggled="toggleGrayCanonical" />
              </div>
              <div ref="grayPanelEl" id="gray-panel" class="editor-gray-panel-box"></div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 主区：3D 视图为中心 -->
      <main class="editor-main">
        <div ref="editorViewEl" id="editor-view" class="editor-view">
          <div id="editor-status" class="save-status">{{ statusText }}</div>
          <button
            id="editor-save"
            class="editor-save-btn"
            :class="{ failed: saveFailed, dirty: isDirty }"
            :title="isDirty ? t('editor.unsaved') : t('editor.save')"
            @click="onSave">
            <span class="editor-save-icon" aria-hidden="true">{{ "\uE8A5" }}</span>
          </button>
          <button
            id="editor-big-play"
            class="editor-big-play"
            :class="{ playing }"
            :title="t(playing ? 'editor.pause' : 'editor.play')"
            @click="onPvPlay">
            <span class="editor-big-play-icon" aria-hidden="true">{{ playing ? "\uE769" : "\uE768" }}</span>
          </button>
          <div v-show="maskVisible" id="editor-play-mask" class="editor-play-mask">{{ t("editor.playHint") }}</div>
        </div>

        <!-- 时间线 -->
        <div class="editor-timeline-panel">
          <div class="tl-playback-controls">
            <WinToggleSwitch v-model:IsOn="loopPlay" :OnContent="t('editor.loopOn')" :OffContent="t('editor.loopOff')" />
            <WinToggleSwitch v-model:IsOn="reversePlay" :OnContent="t('editor.reverseOn')" :OffContent="t('editor.reverseOff')" />
            <WinToggleSwitch v-model:IsOn="autoKf" :OnContent="t('editor.autoKfOn')" :OffContent="t('editor.autoKfOff')" />
            <WinTextBlock class="editor-label" :Text="t('editor.frameRate')" FontSize="13" />
            <select id="kf-framerate" class="native-select" :value="tech?.frameRate ?? 60" @change="onFrameRateChange">
              <option v-for="fr in FRAME_RATE_PRESETS" :key="fr" :value="fr">{{ fr }}</option>
            </select>
            <WinTextBlock class="editor-label" :Text="t('editor.speed')" FontSize="13" />
            <select id="play-speed" class="native-select" :value="playSpeed" @change="onPlaySpeedChange">
              <option v-for="s in PLAY_SPEED_PRESETS" :key="s" :value="s">{{ s }}x</option>
            </select>
          </div>
          <div class="tl-wrap" @wheel="onTlWheel">
            <div
              id="tl-ruler"
              class="tl-ruler"
              :style="{ width: tlWidth }"
              @pointerdown="onRulerSeek"
              @pointermove="onRulerMove"
              @pointerup="onRulerEnd"
              @pointercancel="onRulerEnd"
              @pointerleave="onRulerEnd">
              <span
                v-for="bt in beatTicks"
                :key="`b${bt.frame}`"
                class="tl-tick-beat"
                :style="{ left: `${bt.frame * pxPerFrame}px` }">
                {{ bt.beat % 1 === 0 ? bt.beat : "" }}
              </span>
              <button
                v-for="kf in sortedKeyframes"
                :key="kf.frame"
                class="tl-kf"
                :class="{ selected: selectedFrame === kf.frame }"
                :data-frame="kf.frame"
                :style="{ left: `${kf.frame * pxPerFrame - 5}px` }"
                :title="`${kf.frame} (${(kf.frame / (tech?.frameRate ?? 60)).toFixed(2)}s)`"
                @click="selectKf(kf.frame)"></button>
              <span
                v-for="tick in rulerTicks"
                :key="tick.frame"
                :class="tick.major ? 'tl-tick-major' : 'tl-tick-minor'"
                :style="{ left: `${tick.frame * pxPerFrame}px` }">
                {{ tick.major ? `${(tick.frame / (tech?.frameRate ?? 60)).toFixed(1)}s` : "" }}
              </span>
            </div>
            <div
              id="tl-track"
              class="tl-track"
              :style="{ width: tlWidth }"
              @pointerdown="onTrackPointerDown">
              <span
                v-for="band in stepBands"
                :key="band.stepIndex"
                class="tl-step-band"
                :class="{ selected: selectedSteps.includes(band.stepIndex), pause: band.kind === 'pause' }"
                :data-step-index="band.stepIndex"
                :style="{ left: `${band.startFrame * pxPerFrame}px`, width: `${Math.max((band.endFrame - band.startFrame) * pxPerFrame, 8)}px` }">
                {{ band.kind === "pause" ? "P" : `S${band.stepIndex + 1}` }}
              </span>
              <div
                id="tl-playhead"
                class="tl-playhead"
                :style="{ left: `${previewFrame * pxPerFrame}px` }"></div>
            </div>
          </div>
          <div v-if="tech && stepBands.length" class="step-durations">
            <WinTextBlock class="editor-label" :Text="t('editor.stepDuration')" FontSize="14" />
            <template v-if="selectedSteps.length === 1 && stepBands[selectedSteps[0]]">
              <label class="step-dur">
                <span class="step-dur-name">S{{ selectedSteps[0] + 1 }}</span>
                <input
                  :id="`step-dur-${selectedSteps[0]}`"
                  type="number"
                  min="0.1"
                  :max="maxStepSec"
                  step="0.01"
                  class="native-input num-input"
                  :value="((stepBands[selectedSteps[0]].endFrame - stepBands[selectedSteps[0]].startFrame) / (tech?.frameRate ?? 60)).toFixed(2)"
                  @change="onStepDurationChange($event, selectedSteps[0])" />
                <span>s</span>
              </label>
              <WinButton :Content="t('editor.stepDone')" @Click="selectedSteps = []" />
              <WinButton id="insert-pause" :Content="t('editor.insertPause')" @Click="insertPauseAfter" />
            </template>
            <template v-else-if="selectedSteps.length > 1">
              <label class="step-dur">
                <span class="step-dur-name">{{ t("editor.batchSteps", { n: selectedSteps.length }) }}</span>
                <input
                  id="batch-step-dur"
                  ref="batchStepDurEl"
                  type="number"
                  min="0.1"
                  :max="maxBatchStepSec"
                  step="0.01"
                  class="native-input num-input"
                  value="0.30" />
                <span>s</span>
              </label>
              <WinButton id="batch-apply" :Content="t('editor.batchApply', { n: selectedSteps.length })" @Click="onBatchApply" />
              <WinButton :Content="t('editor.stepDone')" @Click="selectedSteps = []" />
            </template>
            <span v-else class="meta">{{ t("editor.stepHint") }}</span>
          </div>
          <p id="tl-meta" ref="tlMetaEl" class="page-note"></p>
        </div>
      </main>
    </div>
  </div>
</template>

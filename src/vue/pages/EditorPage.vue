<script setup lang="ts">
/**
 * 动画编辑器（Vue 迁移版）：时间线/关键帧/补帧预览/3D 视口全部声明式重写。
 * 测试依赖的控件保持原生（select/number/range，playtest 直接操作 DOM），
 * 按钮与标题使用 Win 控件。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import WinToggleSwitch from "../../vendor/winui-on-web/components/WinToggleSwitch.vue";
import { Euler, Quaternion } from "three";
import { CubePlayer } from "../../cube/CubePlayer";
import { GrayOverlay } from "../../cube/GrayOverlay";
import { createGrayState, presetGrayState, type GrayPreset, type GrayState } from "../../cube/stickering";
import { loadLibrary, saveLibrary, upsertTechniqueInLib } from "../../data/libraryStore";
import {
  createTechnique,
  removeKeyframe,
  upsertKeyframe,
  type Easing,
  type StepMapping,
  type Technique,
} from "../../data/technique";
import { defaultHandPose, FINGER_ORDER, type Contact, type HandType, type Pose } from "../../hand/HandRig";
import { HandRigView } from "../../hand/HandRigView";
import { KeymapController } from "../../input/keymap";
import { invertMoves, parseMoves, splitCompoundMove } from "../../notation/alg";
import { loadEditorKeymap, loadSettings } from "../../settings";
import { renderGrayPanel } from "../../ui/grayPanel";
import {
  applyEasing,
  interpolatePose,
  keyframeSegment,
  type EasingFn,
} from "../../timeline/Timeline";
import { useI18n } from "../i18n";

const { t } = useI18n();

const TL_ZOOM_MIN = 0.5;
const TL_ZOOM_MAX = 16;
/** 时间线像素/帧：默认 6（原 2 的 3 倍，长条更易读），Ctrl+滚轮在 0.5~16 缩放 */
const pxPerFrame = ref(6);
const PREVIEW_SAMPLE_STEP = 15;
const AUTO_PATH_STEP = 15; // 自动路径中间关键帧间隔（帧）
const SNAP_STEP = 1 / 3; // 吸附步长：1/3 块边长（sticker 网格）
// 每动作默认时长（秒）：编辑器默认步时 0.3s（"正常动作"），与 cubing 基准 1s 分离；
// 播放时 tempoScale = 1.0 / 步时，动画精确匹配
const STEP_DEFAULT_SEC = 0.3;

const lib = ref(loadLibrary());
const tech = ref<Technique | null>(null);
const selectedFrame = ref<number | null>(null);
const playing = ref(false);
const loopPlay = ref(false); // 播放循环开关（默认不循环）
const reversePlay = ref(false); // 倒放开关
const previewFrame = ref(0);
const statusText = ref("");
/** 倒放逆序执行指针：已逆序执行到第几步（从 formulaMoves.length 递减到 0） */
let revApplied = 0;
/** 已应用的公式动作数（空拍不消耗；stepIndex 为序列位置） */
let moveCursor = 0;
let lastTickAt = 0;

/** 播放器整合：公式 step 与手法 stepMapping 帧级同步 */
// cubing 默认单步动画基准时长（tempoScale=1 时 1000ms，见 AlgDuration.defaultDurationForAmount）。
// 之前误设 0.3 导致 tempoScale 校准错误：0.3s 步时配 tempoScale=1 时动画需 1s、只播 0.3s
// 就被下一步 cancel → 执行完"没到位直接跳变"。
const CUBING_MOVE_SECONDS = 1.0;
let formulaMoves: string[] = [];
let stepMoveIndex = 0;

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
const kfPoseXEl = ref<HTMLInputElement | null>(null);
const kfPoseYEl = ref<HTMLInputElement | null>(null);
const kfPoseZEl = ref<HTMLInputElement | null>(null);
const kfPoseRxEl = ref<HTMLInputElement | null>(null);
const kfPoseRyEl = ref<HTMLInputElement | null>(null);
const kfPoseRzEl = ref<HTMLInputElement | null>(null);
const addFrameEl = ref<HTMLInputElement | null>(null);
const pvSliderEl = ref<HTMLInputElement | null>(null);
const pvReadoutEl = ref<HTMLElement | null>(null);
const pvPoseEl = ref<HTMLElement | null>(null);

let player: CubePlayer | null = null;
let handView: HandRigView | null = null;
let editorKeymap: KeymapController | null = null;
let timer: number | null = null;
let viewIo: IntersectionObserver | null = null;
let kickTimers: number[] = [];
const snapOn = ref(true);
const grayState = ref<GrayState>(createGrayState());
const grayKind = ref<"mutable" | "immutable">("mutable");
const grayPanelOpen = ref(false);
const grayPanelEl = ref<HTMLElement | null>(null);
/** 时间线展开（3D 视口下方显示，侧边栏按钮切换） */
const timelineOpen = ref(false);
/** 魔方/手显隐（快捷键 C/H + 侧边栏按钮） */
const showCube = ref(true);
const showHand = ref(true);
let grayOverlay: GrayOverlay | null = null;
let grayPanelApi: ReturnType<typeof renderGrayPanel> | null = null;
const maskVisible = ref(false);
let maskTimer: number | null = null;
/** 选中动作块（S1…，支持 Ctrl/Shift 多选）高亮后在下侧设定时长 */
const selectedSteps = ref<number[]>([]);
/** 关键帧编辑折叠区（时间线内展开；点关键帧箭头自动展开） */
const kfPanelOpen = ref(false);
let seeking = false;

/** 时间线播放头/轨道 seek：按点击位置换算帧号 */
const seekFromEvent = (clientX: number, track: HTMLElement): void => {
  const rect = track.getBoundingClientRect();
  const total = Math.max(totalFrames.value, 60);
  const frame = Math.max(0, Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * total));
  previewFrame.value = Math.min(frame, total);
  syncCubeToFrame(previewFrame.value);
  renderPreview();
};

/** 同步魔方状态到目标帧：起始态 + 已执行步骤（拖动播放头后状态与帧一致） */
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
  player.element.alg = moves.length ? `${start} ${moves.join(" ")}` : start;
  void player.element
    .experimentalCurrentVantages()
    .then((vs) => {
      for (const v of vs) v.scheduleRender();
    })
    .catch(() => {});
};

const onTrackPointerDown = (e: PointerEvent): void => {
  // 点到动作块：只选中不 seek；其余位置 seek 并进入拖动
  if ((e.target as HTMLElement).closest?.(".tl-step-band")) return;
  if (selectedSteps.value.length > 0) selectedSteps.value = []; // 点空白取消多选
  if (playing.value) playing.value = false; // 定位先停止播放
  seeking = true;
  seekFromEvent(e.clientX, e.currentTarget as HTMLElement);
};
const onTrackPointerMove = (e: PointerEvent): void => {
  if (!seeking || !(e.buttons & 1)) return;
  seekFromEvent(e.clientX, e.currentTarget as HTMLElement);
};
const endSeek = (): void => {
  seeking = false;
};

const selectStep = (i: number, e?: MouseEvent): void => {
  if (e?.ctrlKey || e?.metaKey) {
    // Ctrl：切换加入/取消多选
    selectedSteps.value = selectedSteps.value.includes(i)
      ? selectedSteps.value.filter((x) => x !== i)
      : [...selectedSteps.value, i];
  } else if (e?.shiftKey && selectedSteps.value.length > 0) {
    // Shift：从最后选中到 i 的区间追加
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

/** 逐帧步进：←/→ 每帧；Shift+←/→ 跳相邻关键帧 */
const stepFrames = (dir: 1 | -1, jumpKf: boolean): void => {
  if (!tech.value) return;
  if (playing.value) playing.value = false; // 步进先停止播放（避免被播放循环覆盖）
  const total = totalFrames.value;
  if (jumpKf && tech.value.keyframes.length > 0) {
    const frames = [...tech.value.keyframes].map((k) => k.frame).sort((a, b) => a - b);
    const cur = previewFrame.value;
    if (dir > 0) {
      const next = frames.find((f) => f > cur);
      previewFrame.value = next ?? frames[frames.length - 1];
    } else {
      const prev = [...frames].reverse().find((f) => f < cur);
      previewFrame.value = prev ?? frames[0];
    }
  } else {
    previewFrame.value = Math.min(total, Math.max(0, previewFrame.value + dir));
  }
  syncCubeToFrame(previewFrame.value);
  renderPreview();
};

const toggleShowCube = (): void => {
  showCube.value = !showCube.value;
  player?.showCube(showCube.value);
};
const toggleShowHand = (): void => {
  showHand.value = !showHand.value;
  handView?.setVisible(showHand.value);
};

/** 捕获当前魔方状态为 正放/倒放 起始态 */
const captureStart = (which: "startState" | "reverseStart"): void => {
  if (!tech.value) {
    statusText.value = t("editor.playHint");
    return;
  }
  const algStr = player?.element.alg ?? "";
  if (!algStr) {
    statusText.value = t("editor.captureEmpty");
    return;
  }
  commit((t2) => ({ ...t2, [which]: algStr }));
};

const clearStartStates = (): void => {
  if (!tech.value) return;
  commit((t2) => ({ ...t2, startState: undefined, reverseStart: undefined }));
};

const startStateLabel = computed(() => {
  const fmt = (v?: string): string => (v ? v.slice(0, 16) : "默认");
  return `${t("editor.forward")}: ${fmt(tech.value?.startState)} ｜ ${t("editor.reverse")}: ${fmt(tech.value?.reverseStart)}`;
});

// 编辑器快捷键：Space=播放（页面不滚动后可用）、C=魔方显隐、H=手显隐
let spaceDownAt = 0;
let spaceCombined = false;
const onEditorKey = (e: KeyboardEvent): void => {
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
  if (e.code === "Space") {
    if (e.type === "keydown") {
      spaceDownAt = performance.now();
      spaceCombined = false;
      e.preventDefault(); // 阻止滚动（页面不滚动目标；也防误滚动）
    } else if (e.type === "keyup" && !spaceCombined && performance.now() - spaceDownAt < 600) {
      onPvPlay();
    }
    return;
  }
  if (e.type !== "keydown") return;
  if (e.code === "KeyC") {
    toggleShowCube();
    return;
  }
  if (e.code === "KeyH") {
    toggleShowHand();
    return;
  }
  if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
    stepFrames(e.code === "ArrowRight" ? 1 : -1, e.shiftKey);
    return;
  }
  if (spaceDownAt && performance.now() - spaceDownAt < 600) spaceCombined = true;
};

const totalFrames = computed(() => {
  if (!tech.value) return 0;
  // 允许无关键帧播放：时长取 最后关键帧 / 步骤区间终点 的最大值（至少 1 秒）
  const kfLast = tech.value.keyframes.length
    ? tech.value.keyframes[tech.value.keyframes.length - 1].frame
    : 0;
  const stepLast = tech.value.stepMapping.reduce((m, s) => Math.max(m, s.endFrame), 0);
  return Math.max(kfLast, stepLast, 60);
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

const tlWidth = computed(() => `${Math.max(totalFrames.value, 60) * pxPerFrame.value}px`);

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
  { value: "right", label: t("editor.handRight") },
  { value: "left", label: t("editor.handLeft") },
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

/** 当前帧活跃的接触（来自手法 contactTracks 精确起止帧） */
function activeContactsAt(frame: number): Contact[] {
  if (!tech.value) return [];
  return tech.value.contactTracks
    .filter((c) => c.startFrame <= frame && frame <= c.endFrame)
    .map((c) => c.contact);
}

function poseSummary(pose: Pose, contacts: Contact[] = pose.contacts): string {
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
  lines.push(`contacts: ${contacts.length ? contacts.map((c) => `${c.finger}→${c.target}`).join(", ") : "—"}`);
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
      contact: (() => {
        const act = activeContactsAt(f);
        return act.length ? `${act[0].finger}→${act[0].target}` : "—";
      })(),
    });
  }
  return rows;
});

function renderSelected(keepInputs = false): void {
  const kf =
    selectedFrame.value === null
      ? null
      : tech.value?.keyframes.find((k) => k.frame === selectedFrame.value);
  if (kfFrameEl.value) kfFrameEl.value.value = kf ? String(kf.frame) : "";
  if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
  if (kfPoseEl.value) {
    kfPoseEl.value.textContent = kf
      ? poseSummary(kf.pose, activeContactsAt(kf.frame))
      : tech.value
        ? t("editor.noKfSelected")
        : "";
  }
  const pos = kf?.pose.palm.transform.position;
  // 坐标输入过程中不回写 value（对齐标定页手感，连续输入不被打断）
  if (!keepInputs) {
    if (kfPoseXEl.value) kfPoseXEl.value.value = pos ? pos.x.toFixed(2) : "";
    if (kfPoseYEl.value) kfPoseYEl.value.value = pos ? pos.y.toFixed(2) : "";
    if (kfPoseZEl.value) kfPoseZEl.value.value = pos ? pos.z.toFixed(2) : "";
    const rot = kf ? poseRotationDeg(kf.pose) : null;
    if (kfPoseRxEl.value) kfPoseRxEl.value.value = rot ? rot.x.toFixed(0) : "";
    if (kfPoseRyEl.value) kfPoseRyEl.value.value = rot ? rot.y.toFixed(0) : "";
    if (kfPoseRzEl.value) kfPoseRzEl.value.value = rot ? rot.z.toFixed(0) : "";
  }
  if (kfDeleteEl.value) kfDeleteEl.value.disabled = !kf;
}

const degToRad = (d: number): number => (d * Math.PI) / 180;

/** 手掌四元数 → 欧拉角（度，three XYZ 顺序）；quaternion 字段序 {w,x,y,z} */
function poseRotationDeg(pose: Pose): { x: number; y: number; z: number } {
  const q = pose.palm.transform.quaternion;
  const e = new Euler().setFromQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
  return { x: (e.x * 180) / Math.PI, y: (e.y * 180) / Math.PI, z: (e.z * 180) / Math.PI };
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
  if (pvPoseEl.value) {
    pvPoseEl.value.textContent = pose
      ? poseSummary(pose, activeContactsAt(previewFrame.value))
      : t("editor.needKf");
  }
  if (handView) {
  handView.setPose(pose ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right"));
  }
}

function renderAll(keepInputs = false): void {
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
  renderSelected(keepInputs);
  renderPreview();
}

function selectTech(id: string): void {
  selectedFrame.value = null;
  previewFrame.value = 0;
  tech.value = lib.value.techniques.find((x) => x.id === id) ?? null;
  computeFormulaMoves();
  // 补全动作刻度：stepMapping 为空时按 公式步数 × 每步默认时长 生成
  if (tech.value && tech.value.stepMapping.length === 0 && formulaMoves.length > 0) {
    tech.value = {
      ...tech.value,
      stepMapping: buildStepMappingFromMoves(formulaMoves, tech.value.frameRate),
    };
  }
  stepMoveIndex = 0;
  revApplied = formulaMoves.length;
  // 手法起始态 = 公式逆序状态（从还原态逆序执行公式），而非还原态
  setStartState();
  renderAll();
}

/** 正放起始态：优先自定义 startState，缺省 = 公式逆序状态（打乱态 S） */
function setStartState(): void {
  if (!player) return;
  player.element.alg =
    tech.value?.startState ??
    (formulaMoves.length ? invertMoves(formulaMoves.join(" ")) : "");
}

/** 倒放起始态：优先自定义 reverseStart，缺省 = 还原态 */
function setReverseStart(): void {
  if (!player) return;
  player.element.alg = tech.value?.reverseStart ?? "";
}

/** 按公式步数生成等长动作区间：第 i 步占 [i*t, (i+1)*t]（t = 每动作时长） */
function buildStepMappingFromMoves(moves: string[], frameRate: number): StepMapping[] {
  const frames = Math.round(STEP_DEFAULT_SEC * frameRate);
  return moves.map((_, i) => ({
    stepIndex: i,
    startFrame: i * frames,
    endFrame: (i + 1) * frames,
  }));
}

/** 解析当前手法关联公式为单步 move 列表（与 stepMapping.stepIndex 对齐） */
function computeFormulaMoves(): void {
  formulaMoves = [];
  if (!tech.value) return;
  const f = lib.value.formulas.find((x) => x.id === tech.value!.formulaId);
  if (!f) return;
  const parsed = parseMoves(f.moves);
  if (!parsed.ok) return;
  // 去括号 + 拆分复合动作（如 "UD'" → U、D'）：cubing 动画处理复合动作会崩溃
  // （areQuantumMovesSameAxis），单面顺序执行既稳定又与记法语义等价
  const tokens = parsed.normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.replace(/[()]/g, ""));
  formulaMoves = tokens.flatMap(splitCompoundMove);
}

/** 步进时长校准：让 cubing 单步动画时长 ≈ stepMapping 区间时长 */
function syncStepSpeed(): void {
  if (!tech.value) return;
  const m0 = tech.value.stepMapping[0];
  if (!m0) return;
  const stepSec = (m0.endFrame - m0.startFrame) / tech.value.frameRate;
  if (stepSec > 0) player?.setSpeed(CUBING_MOVE_SECONDS / stepSec);
}

/** 播放推进：previewFrame 进入 step 区间时对魔方执行对应公式步 */
function applyStepAtFrame(frame: number): void {
  if (!tech.value) return;
  for (const m of tech.value.stepMapping) {
    if (m.stepIndex !== stepMoveIndex) continue;
    if (frame < m.startFrame) break;
    if (m.kind === "pause") {
      // 空拍：魔方不动作（手部动画继续）
      stepMoveIndex++;
      continue;
    }
    const move = formulaMoves[moveCursor];
    if (move) player?.applyMove(move);
    moveCursor++;
    stepMoveIndex++;
  }
}

function commit(fn: (t2: Technique) => Technique, keepInputs = false): void {
  if (!tech.value) return;
  try {
    tech.value = fn(tech.value);
    stepMoveIndex = 0;
    computeFormulaMoves();
    renderAll(keepInputs);
  } catch (e) {
    statusText.value = t("editor.kfFail", { error: e instanceof Error ? e.message : String(e) });
  }
}

const onTecChange = (e: Event): void => {
  selectTech((e.target as HTMLSelectElement).value);
};

const onHandTypeChange = (e: Event): void => {
  handView?.setHandType((e.target as HTMLSelectElement).value as HandType);
  renderPreview(); // 默认手位随手型更新（左右手镜像位置/朝向）
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

/** 姿态坐标编辑（手掌位置 X/Y/Z；吸附开启时按 1/3 块边长取整） */
const onPoseInput = (e: Event, axis: "x" | "y" | "z"): void => {
  if (!tech.value) return;
  if (selectedFrame.value === null) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  const raw = (e.target as HTMLInputElement).value;
  let v = Number(raw);
  if (!Number.isFinite(v)) return;
  if (snapOn.value) v = Math.round(v / SNAP_STEP) * SNAP_STEP;
  commit((t2) => {
    const k2 = t2.keyframes.find((k) => k.frame === selectedFrame.value);
    if (!k2) return t2;
    return upsertKeyframe(t2, {
      ...k2,
      pose: {
        ...k2.pose,
        palm: {
          ...k2.pose.palm,
          transform: {
            ...k2.pose.palm.transform,
            position: { ...k2.pose.palm.transform.position, [axis]: v },
          },
        },
      },
    });
  }, true);
};

/** 手掌三方向旋转（欧拉角，度）：三输入合成为四元数写入关键帧 */
const onPoseRotInput = (): void => {
  if (!tech.value) return;
  if (selectedFrame.value === null) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  const rx = Number(kfPoseRxEl.value?.value ?? "0");
  const ry = Number(kfPoseRyEl.value?.value ?? "0");
  const rz = Number(kfPoseRzEl.value?.value ?? "0");
  if (![rx, ry, rz].every((v) => Number.isFinite(v))) return;
  const q = new Quaternion().setFromEuler(new Euler(degToRad(rx), degToRad(ry), degToRad(rz)));
  commit((t2) => {
    const k2 = t2.keyframes.find((k) => k.frame === selectedFrame.value);
    if (!k2) return t2;
    return upsertKeyframe(t2, {
      ...k2,
      pose: {
        ...k2.pose,
        palm: {
          ...k2.pose.palm,
          transform: {
            ...k2.pose.palm.transform,
            quaternion: { w: q.w, x: q.x, y: q.y, z: q.z },
          },
        },
      },
    });
  }, true);
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
    const pose = src ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right");
    return upsertKeyframe(t2, { frame: target, pose });
  });
  selectedFrame.value = target;
  renderAll();
};

const onPvPlay = (): void => {
  if (!tech.value) {
    // 未选手法：半透明灰字蒙版提示
    maskVisible.value = true;
    if (maskTimer !== null) clearTimeout(maskTimer);
    maskTimer = window.setTimeout(() => (maskVisible.value = false), 2600);
    return;
  }
  if (!playing.value) {
    computeFormulaMoves();
    syncStepSpeed();
    if (reversePlay.value) {
      // 倒放：从停止位置继续；仅当已在末尾时从头（reverseStart）倒放
      if (previewFrame.value >= totalFrames.value) {
        setReverseStart();
        stepMoveIndex = 0;
        moveCursor = 0;
        revApplied = tech.value.stepMapping.length;
      }
    } else {
      // 正放：从停止位置继续；仅当在开头时设起始态
      if (previewFrame.value <= 0) {
        setStartState();
        stepMoveIndex = 0;
        moveCursor = 0;
      }
    }
    lastTickAt = 0;
  }
  playing.value = !playing.value;
};

// 切换循环/倒放时强制刷新（停止 + 重置），避免方向切换造成的状态错乱
watch([loopPlay, reversePlay], () => {
  if (!playing.value) return;
  playing.value = false;
  stepMoveIndex = 0;
  moveCursor = 0;
  revApplied = tech.value?.stepMapping.length ?? 0;
  previewFrame.value = 0;
  if (reversePlay.value) setReverseStart();
  else setStartState();
  renderPreview();
});

/** 每动作完成时长编辑（秒，最小值 > 0）：修改后按顺序连续重建 stepMapping */
/** 按每步目标时长重建 stepMapping，并等比例重映射关键帧/接触轨道 */
const rebuildWithDurations = (t2: Technique, durationFor: (idx: number) => number): Technique => {
  const secs = t2.stepMapping.map((_, i) => durationFor(i));
  let acc = 0;
  const stepMapping = secs.map((s, i) => {
    const startFrame = Math.round(acc * t2.frameRate);
    acc += s;
    return { stepIndex: i, startFrame, endFrame: Math.round(acc * t2.frameRate) };
  });
  // 等比例重映射（检查轮 2026-08-13）：关键帧 + 接触轨道 统一按
  // 原所属步骤内的相对进度映射到新步骤；步骤外按总时长等比例缩放。
  const remapFrame = (frame: number): number => {
    const old = t2.stepMapping;
    const oldTotal = Math.max(old.length ? old[old.length - 1].endFrame : 1, 1);
    const newTotal = Math.max(stepMapping.length ? stepMapping[stepMapping.length - 1].endFrame : 1, 1);
    const step = old.find((m) => frame >= m.startFrame && frame <= m.endFrame);
    if (!step || old.length === 0) {
      return Math.round((frame / oldTotal) * newTotal);
    }
    const ratio = (frame - step.startFrame) / Math.max(step.endFrame - step.startFrame, 1);
    const ns = stepMapping[step.stepIndex];
    return Math.round(ns.startFrame + ratio * (ns.endFrame - ns.startFrame));
  };
  return {
    ...t2,
    stepMapping,
    keyframes: t2.keyframes.map((kf) => ({ ...kf, frame: remapFrame(kf.frame) })),
    contactTracks: t2.contactTracks.map((c) => ({
      ...c,
      startFrame: remapFrame(c.startFrame),
      endFrame: remapFrame(c.endFrame),
    })),
  };
};

const onStepDurationChange = (e: Event, idx: number): void => {
  if (!tech.value) return;
  const sec = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(sec) || sec <= 0) {
    renderAll();
    return;
  }
  commit((t2) =>
    rebuildWithDurations(
      t2,
      (i) => (i === idx ? sec : (t2.stepMapping[i].endFrame - t2.stepMapping[i].startFrame) / t2.frameRate),
    ),
  );
};

/** 多选动作块：统一设置选中步骤的时长 */
const onBatchApply = (): void => {
  if (!tech.value || selectedSteps.value.length < 2) return;
  const el = document.getElementById("batch-step-dur") as HTMLInputElement | null;
  const sec = Number(el?.value);
  if (!Number.isFinite(sec) || sec <= 0) {
    renderAll();
    return;
  }
  const sel = new Set(selectedSteps.value);
  commit((t2) =>
    rebuildWithDurations(
      t2,
      (i) => (sel.has(i) ? sec : (t2.stepMapping[i].endFrame - t2.stepMapping[i].startFrame) / t2.frameRate),
    ),
  );
};

/** 在选中步骤后插入空拍（魔方不动作、手部动画继续；默认 1 拍时长） */
const insertPauseAfter = (): void => {
  if (!tech.value || selectedSteps.value.length !== 1) return;
  const idx = selectedSteps.value[0];
  commit((t2) => {
    const old = t2.stepMapping;
    const dur = (m: StepMapping): number => (m.endFrame - m.startFrame) / t2.frameRate;
    const newDur: number[] = [];
    const newKind: ("move" | "pause")[] = [];
    for (let i = 0; i <= idx; i++) {
      newDur.push(dur(old[i]));
      newKind.push(old[i].kind ?? "move");
    }
    newDur.push(STEP_DEFAULT_SEC);
    newKind.push("pause");
    for (let i = idx + 1; i < old.length; i++) {
      newDur.push(dur(old[i]));
      newKind.push(old[i].kind ?? "move");
    }
    let acc = 0;
    const stepMapping = newDur.map((s, i) => {
      const startFrame = Math.round(acc * t2.frameRate);
      acc += s;
      return { stepIndex: i, startFrame, endFrame: Math.round(acc * t2.frameRate), kind: newKind[i] };
    });
    // remap：old step i（i > idx）平移到新序列 i+1；关键帧/接触按原步内比例映射
    const remapFrame = (frame: number): number => {
      const oldTotal = Math.max(old.length ? old[old.length - 1].endFrame : 1, 1);
      const newTotal = Math.max(stepMapping.length ? stepMapping[stepMapping.length - 1].endFrame : 1, 1);
      const step = old.find((m) => frame >= m.startFrame && frame <= m.endFrame);
      if (!step || old.length === 0) return Math.round((frame / oldTotal) * newTotal);
      const newIdx = step.stepIndex + (step.stepIndex > idx ? 1 : 0);
      const ratio = (frame - step.startFrame) / Math.max(step.endFrame - step.startFrame, 1);
      const ns = stepMapping[newIdx];
      return Math.round(ns.startFrame + ratio * (ns.endFrame - ns.startFrame));
    };
    return {
      ...t2,
      stepMapping,
      keyframes: t2.keyframes.map((kf) => ({ ...kf, frame: remapFrame(kf.frame) })),
      contactTracks: t2.contactTracks.map((c) => ({
        ...c,
        startFrame: remapFrame(c.startFrame),
        endFrame: remapFrame(c.endFrame),
      })),
    };
  });
};

/** 时间线缩放：Ctrl+滚轮 */
const onTlWheel = (e: WheelEvent): void => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  pxPerFrame.value = Math.min(TL_ZOOM_MAX, Math.max(TL_ZOOM_MIN, pxPerFrame.value * factor));
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

/** 起终自动路径：在首末关键帧之间用 slerp 插值生成中间关键帧（params.md path.auto） */
const onAutoPath = (): void => {
  if (!tech.value || tech.value.keyframes.length < 2) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  const sorted = [...tech.value.keyframes].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last.frame - first.frame <= AUTO_PATH_STEP) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  commit((t2) => {
    let acc = t2;
    for (let f = first.frame + AUTO_PATH_STEP; f < last.frame; f += AUTO_PATH_STEP) {
      const t = (f - first.frame) / (last.frame - first.frame);
      acc = upsertKeyframe(acc, {
        frame: f,
        pose: interpolatePose(first.pose, last.pose, t),
        easing: first.easing ?? "linear",
      });
    }
    return acc;
  });
  statusText.value = t("editor.autoPathDone");
};

/** 插入中间帧：在选中关键帧与其后一帧之间插入 slerp 插值帧 */
const onInsertMid = (): void => {
  if (!tech.value || selectedFrame.value === null) {
    statusText.value = t("editor.insertMidNeed");
    return;
  }
  const sorted = [...tech.value.keyframes].sort((a, b) => a.frame - b.frame);
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
  commit((t2) =>
    upsertKeyframe(t2, {
      frame: mid,
      pose: interpolatePose(a.pose, b.pose, (mid - a.frame) / (b.frame - a.frame)),
      easing: a.easing ?? "linear",
    }),
  );
  statusText.value = t("editor.insertMidDone");
};

/** 正弦函数路径：首末关键帧间按正弦缓动生成中间帧（各指关节 bend 用 sin²(πt/2)） */
const onSinePath = (): void => {
  if (!tech.value || tech.value.keyframes.length < 2) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  const sorted = [...tech.value.keyframes].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (last.frame - first.frame <= AUTO_PATH_STEP) {
    statusText.value = t("editor.autoPathNeed");
    return;
  }
  commit((t2) => {
    let acc = t2;
    for (let f = first.frame + AUTO_PATH_STEP; f < last.frame; f += AUTO_PATH_STEP) {
      const t = (f - first.frame) / (last.frame - first.frame);
      const base = interpolatePose(first.pose, last.pose, t);
      // 正弦缓动：位置/朝向仍线性/slerp，关节 bend 用 sin² 平滑
      const e = Math.sin((Math.PI / 2) * t) ** 2;
      const bends = {} as Pose["bends"];
      for (const name of FINGER_ORDER) {
        const arrA = first.pose.bends[name];
        const arrB = last.pose.bends[name];
        bends[name] = arrA.map((v, i) => v + ((arrB[i] ?? v) - v) * e);
      }
      acc = upsertKeyframe(acc, {
        frame: f,
        pose: { ...base, bends },
        easing: first.easing ?? "linear",
      });
    }
    return acc;
  });
  statusText.value = t("editor.sinePathDone");
};

/** 编辑器标灰面板：切换显示时惰性渲染；预设/点选走 GrayState + 3D 覆盖层 */
const toggleGrayPanel = (): void => {
  grayPanelOpen.value = !grayPanelOpen.value;
  if (!grayPanelOpen.value || !grayPanelEl.value || grayPanelApi) return;
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
    applyPreset: (p: GrayPreset | "clear") => {
      grayState.value = p === "clear" ? createGrayState() : presetGrayState(p, loadSettings().baseFace);
      grayOverlay?.requestApply(grayState.value);
      grayPanelApi?.refresh();
    },
  });
};

const toggleGrayKind = (): void => {
  grayKind.value = grayKind.value === "mutable" ? "immutable" : "mutable";
};

const selectKf = (frame: number): void => {
  selectedFrame.value = frame;
  previewFrame.value = frame;
  kfPanelOpen.value = true; // 点关键帧箭头 → 展开时间线内编辑区
  renderAll();
};

onMounted(() => {
  if (!editorViewEl.value) return;
  // 编辑器起始底色与游戏一致（设置页六色底）
  player = new CubePlayer(editorViewEl.value, {
    cameraDistance: 8,
    baseFace: loadSettings().baseFace,
  });
  handView = new HandRigView(player);
  void handView.init();
  grayOverlay = new GrayOverlay(player);
  void grayOverlay.init().then(() => grayOverlay?.requestApply(grayState.value));
  // 编辑器快捷键：独立配置（默认与游戏一致），公式键拧视口魔方，特殊键走编辑器动作
  editorKeymap = new KeymapController(
    player,
    {
      onMove: (move) => player?.applyMove(move),
      onSpecial: (action) => {
        if (action === "undo") player?.undoLastMove();
        else if (action === "reset") {
          player?.reset();
          stepMoveIndex = 0;
          previewFrame.value = 0;
          renderPreview();
        } else if (action === "toggle-play") {
          onPvPlay();
        }
      },
    },
    loadEditorKeymap(),
  );
  editorKeymap.attach(window);
  window.addEventListener("keydown", onEditorKey);
  window.addEventListener("keyup", onEditorKey);
  (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor = { player, handView };
  renderAll();
  // 视口渲染兜底：cubing 的 TwistyPlayer 用 IntersectionObserver 懒初始化，
  // 挂载时若视口在折叠线外（或懒初始化未触发）可能长时间空白；
  // 监听可见性 + 定时踢帧，保证进入编辑器即可见魔方/手。
  const kickRender = (): void => {
    void (async () => {
      try {
        const vantages = await player?.element.experimentalCurrentVantages();
        for (const v of vantages ?? []) v.scheduleRender();
      } catch {
        // 场景未就绪时忽略
      }
      handView?.setPose(previewPose() ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right"));
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
      lastTickAt = 0; // 暂停/停止时重置，恢复播放不走大 dt
      return;
    }
    // 精度解耦：按真实时间推进帧号（dt × frameRate），frameRate 不再锁 60
    const now = performance.now();
    const dtSec = lastTickAt ? (now - lastTickAt) / 1000 : 1 / 60;
    lastTickAt = now;
    const stepFrames = Math.max(1, Math.round(dtSec * tech.value.frameRate));
    const total = totalFrames.value;
    if (reversePlay.value) {
      if (previewFrame.value <= 0) {
        if (loopPlay.value) {
          previewFrame.value = total;
          setReverseStart(); // 循环倒放回到倒放起始态
          stepMoveIndex = 0;
          moveCursor = 0;
          revApplied = tech.value.stepMapping.length;
        } else {
          playing.value = false;
        }
      } else {
        previewFrame.value -= stepFrames;
      }
      if (!playing.value) {
        renderPreview();
        return;
      }
      // 倒放：进入未执行过的 step 区间 → 应用该步的逆动作（带动画）
      const sm = tech.value.stepMapping;
      for (let i = sm.length - 1; i >= 0; i--) {
        const m = sm[i];
        if (revApplied > i && previewFrame.value >= m.startFrame && previewFrame.value < m.endFrame) {
          if (m.kind !== "pause") {
            // 该步对应的公式动作 = 前 i+1 个序列步中最后一个 move 步
            const moveCount = sm.slice(0, i + 1).filter((x) => x.kind !== "pause").length;
            const move = formulaMoves[moveCount - 1];
            if (move) player?.applyMove(invertMoves(move));
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
          setStartState(); // 循环正放回到起始态 S
        } else {
          playing.value = false;
        }
      } else {
        previewFrame.value += stepFrames;
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
  viewIo?.disconnect();
  viewIo = null;
  kickTimers.forEach((t) => window.clearTimeout(t));
  kickTimers = [];
  editorKeymap?.detach(window);
  editorKeymap = null;
  window.removeEventListener("keydown", onEditorKey);
  window.removeEventListener("keyup", onEditorKey);
  editorViewEl.value?.replaceChildren();
  delete (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor;
  grayOverlay?.dispose();
  grayOverlay = null;
  player = null;
  handView = null;
});
</script>

<template>
  <div class="editor-page">
    <div id="editor-status" class="save-status">{{ statusText }}</div>

    <div class="editor-layout">
      <!-- 左侧侧边栏（PS 风格）：手法 / 手 / 标灰 / 时间线 -->
      <aside class="editor-sidebar">
        <div class="sb-group">
          <WinTextBlock class="editor-label" :Text="t('editor.technique')" FontSize="13" />
          <select id="tec-select" ref="tecSelectEl" class="native-select" @change="onTecChange">
            <option v-for="opt in techniqueOptions" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
          </select>
          <span id="tec-formula" ref="formulaLabelEl" class="meta"></span>
          <p id="editor-empty" ref="emptyHintEl" class="page-note" hidden>{{ t("editor.empty") }}</p>
        </div>

        <div class="sb-group">
          <WinTextBlock class="editor-label" :Text="t('editor.newAdd')" FontSize="13" />
          <input id="tec-new-name" ref="newNameEl" class="native-input" :placeholder="t('editor.newName')" />
          <select id="tec-new-formula" ref="newFormulaEl" class="native-select">
            <option v-for="opt in formulaOptions" :key="opt.id" :value="opt.id">{{ opt.name }}</option>
          </select>
          <WinButton id="tec-new-add" :Content="t('editor.newAdd')" Style="AccentButtonStyle" @Click="onNewAdd" />
        </div>

        <div class="sb-group">
          <WinTextBlock class="editor-label" :Text="t('editor.handType')" FontSize="13" />
          <select id="view-hand" ref="handTypeSelectEl" class="native-select" @change="onHandTypeChange">
            <option v-for="opt in handTypeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <div class="sb-group">
          <WinButton id="editor-toggle-cube" :Content="showCube ? t('editor.hideCube') : t('editor.showCube')" @Click="toggleShowCube" />
          <WinButton id="editor-toggle-hand" :Content="showHand ? t('editor.hideHand') : t('editor.showHand')" @Click="toggleShowHand" />
          <WinTextBlock class="page-note" :Text="t('editor.toggleHint')" FontSize="11" />
        </div>

        <div class="sb-group">
          <WinTextBlock class="editor-label" :Text="t('editor.startState')" FontSize="13" />
          <WinButton id="capture-start" :Content="t('editor.captureStart')" @Click="captureStart('startState')" />
          <WinButton id="capture-reverse" :Content="t('editor.captureReverse')" @Click="captureStart('reverseStart')" />
          <WinButton id="clear-start" :Content="t('editor.clearStart')" @Click="clearStartStates" />
          <span class="meta">{{ startStateLabel }}</span>
        </div>

        <div class="sb-group">
          <WinButton id="editor-gray-toggle" :Content="t('gray.btn')" @Click="toggleGrayPanel" />
          <div v-show="grayPanelOpen" class="editor-gray-panel">
            <div class="editor-gray-kind-row">
              <WinTextBlock class="editor-label" :Text="t('gray.title')" FontSize="12" />
              <WinToggleSwitch
                class="editor-gray-kind-toggle"
                :IsOn="grayKind === 'immutable'"
                :OnContent="t('gray.kind.immutable')"
                :OffContent="t('gray.kind.mutable')"
                @Toggled="toggleGrayKind" />
            </div>
            <div ref="grayPanelEl" id="gray-panel" class="editor-gray-panel-box"></div>
          </div>
        </div>

        <div class="sb-group">
          <WinButton
            id="editor-timeline-toggle"
            :Content="timelineOpen ? t('editor.timelineHide') : t('editor.timeline')"
            @Click="timelineOpen = !timelineOpen" />
        </div>
      </aside>

      <!-- 主区：3D 视图为中心 -->
      <main class="editor-main">
        <div ref="editorViewEl" id="editor-view" class="editor-view">
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

        <!-- 时间线（侧边栏按钮展开，显示在 3D 视图下方） -->
        <div v-show="timelineOpen" class="editor-timeline-panel">
          <div class="tl-playback-controls">
            <WinToggleSwitch v-model:IsOn="loopPlay" :OnContent="t('editor.loopOn')" :OffContent="t('editor.loopOff')" />
            <WinToggleSwitch v-model:IsOn="reversePlay" :OnContent="t('editor.reverseOn')" :OffContent="t('editor.reverseOff')" />
          </div>
          <div class="tl-wrap" @wheel="onTlWheel">
            <div id="tl-ruler" class="tl-ruler" :style="{ width: tlWidth }">
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
                {{ tick.major ? `${(tick.frame / 60).toFixed(1)}s` : "" }}
              </span>
            </div>
            <div
              id="tl-track"
              class="tl-track"
              :style="{ width: tlWidth }"
              @pointerdown="onTrackPointerDown"
              @pointermove="onTrackPointerMove"
              @pointerup="endSeek"
              @pointercancel="endSeek"
              @pointerleave="endSeek">
              <span
                v-for="band in stepBands"
                :key="band.stepIndex"
                class="tl-step-band"
                :class="{ selected: selectedSteps.includes(band.stepIndex), pause: band.kind === 'pause' }"
                @click="selectStep(band.stepIndex, $event)"
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
                  type="number"
                  min="0.1"
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
          <div v-show="kfPanelOpen" class="kf-edit-panel">
            <div class="kf-edit-head">
              <WinTextBlock class="editor-label" :Text="t('editor.kfEdit')" FontSize="13" />
              <WinButton id="kf-panel-close" :Content="t('editor.stepDone')" @Click="kfPanelOpen = false" />
            </div>
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
            <div class="editor-kf-row pose-row">
              <WinToggleSwitch v-model:IsOn="snapOn" :OnContent="t('editor.snapOn')" :OffContent="t('editor.snapOff')" />
              <WinTextBlock class="editor-label" :Text="t('editor.pose')" FontSize="14" />
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
            <div class="editor-kf-row pose-row">
              <WinTextBlock class="editor-label" :Text="t('editor.poseRot')" FontSize="14" />
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
            <pre id="kf-pose" ref="kfPoseEl" class="kf-pose"></pre>
          </div>
          <p id="tl-meta" ref="tlMetaEl" class="page-note"></p>
        </div>

        <!-- 其余编辑功能（选中关键帧 / 添加 / 补帧预览 / 保存），去标题精简 -->
        <div class="editor-details">
          <div class="editor-add">
            <WinTextBlock class="editor-label" :Text="t('editor.frame')" />
            <input id="kf-add-frame" ref="addFrameEl" type="number" min="0" step="1" class="native-input num-input" value="30" />
            <WinButton id="kf-add" :Content="t('editor.addKf')" Style="AccentButtonStyle" @Click="onKfAdd" />
            <WinButton id="auto-path" :Content="t('editor.autoPath')" @Click="onAutoPath" />
            <WinButton id="kf-insert-mid" :Content="t('editor.insertMid')" @Click="onInsertMid" />
            <WinButton id="sine-path" :Content="t('editor.sinePath')" @Click="onSinePath" />
          </div>
          <WinTextBlock class="page-note" :Text="t('editor.addKfHint')" />

          <div class="editor-pv-controls">
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

          <WinButton id="editor-save" class="editor-save" :Content="t('editor.save')" Style="AccentButtonStyle" @Click="onSave" />
        </div>
      </main>
    </div>
  </div>
</template>

<style>
.editor-page {
  height: 100%;
  box-sizing: border-box;
  overflow: hidden; /* 页面不滚动（目标：space 等快捷键不被滚动捕获） */
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
}

.editor-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
}

.editor-sidebar {
  width: 248px;
  flex-shrink: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sb-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-fill-default);
}

.sb-group .native-select,
.sb-group .native-input {
  width: 100%;
}

.editor-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-timeline-panel {
  flex: 0 0 auto;
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-fill-default);
  max-height: 45%;
  overflow-y: auto;
}

.editor-details {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.pose-row {
  margin-top: 8px;
}

.pose-axis {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 13px;
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
  flex: 1 1 auto;
  min-height: 240px;
  height: auto;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-solid-fill, #101014);
  overflow: hidden;
}

.editor-gray-panel {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-fill-default);
}

.editor-gray-kind-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.editor-gray-panel-box .gray-title {
  font-weight: 600;
  margin-bottom: 6px;
  color: var(--text-primary);
}

.editor-gray-panel-box .gray-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.editor-gray-panel-box .gray-presets button {
  padding: 2px 9px;
  font-size: 12px;
}

.editor-gray-panel-box .gray-net {
  display: block;
  width: 100%;
  height: auto;
  margin: 0 auto;
  user-select: none;
}

.editor-gray-panel-box .gray-cell {
  cursor: pointer;
  stroke-width: 0;
}

.editor-gray-panel-box .gray-body {
  pointer-events: none;
}

.editor-gray-panel-box .gray-face-label {
  font-size: 10px;
  fill: var(--text-tertiary);
  pointer-events: none;
}

.editor-gray-panel-box .gray-net:focus {
  outline: 1px solid var(--accent-base);
  outline-offset: 2px;
}

.tl-playback-controls {
  display: flex;
  gap: 12px;
  margin: 6px 0 8px;
}

.step-durations {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.step-dur {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 13px;
}

.step-dur-name {
  font-family: ui-monospace, Consolas, monospace;
  color: var(--text-primary);
}

.tl-wrap {
  overflow-x: auto;
  padding: 6px 0;
}

.tl-ruler {
  position: relative;
  height: 30px;
  background: var(--ctrl-fill-secondary, #26262c); /* 明显灰色标尺，与页面背景区分 */
  border-radius: 4px 4px 0 0;
  border-bottom: 1px solid var(--stroke-divider);
}

.tl-tick-major,
.tl-tick-minor {
  position: absolute;
  top: 15px;
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
  height: 22px;
  background: var(--ctrl-fill-default, rgba(128, 128, 138, 0.08));
  border-radius: 0 0 4px 4px;
}

.tl-step-band {
  position: absolute;
  top: 2px;
  height: 18px;
  border-radius: 4px;
  background: var(--accent-base);
  color: var(--accent-text);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  opacity: 0.7;
}

.tl-step-band.selected {
  opacity: 1;
  outline: 2px solid var(--accent-hover, #59d5ff);
  outline-offset: 1px;
}

.tl-step-band.pause {
  background: repeating-linear-gradient(
    45deg,
    var(--ctrl-fill-secondary, #3a3a44) 0 6px,
    var(--stroke-divider, #55555e) 6px 12px
  );
  color: var(--text-secondary);
  opacity: 0.9;
}

.tl-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--accent-hover, #59d5ff);
  z-index: 2;
  pointer-events: none;
}

.tl-playhead::after {
  content: "";
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 0;
  width: 9px;
  height: 5px;
  border-radius: 1px;
  background: #fff; /* 末端白色杠标志 */
}

.kf-edit-panel {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-fill-secondary, rgba(128, 128, 138, 0.14));
}

.kf-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.tl-kf {
  position: absolute;
  top: 21px; /* 标尺底部，尖端朝下指向下方动作刻度 */
  width: 10px;
  height: 9px;
  padding: 0;
  border: none;
  background: var(--accent-base); /* 纯三角：clip-path，无残留背景 */
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  cursor: pointer;
}

.tl-kf.selected {
  background: var(--accent-hover, #59d5ff);
  height: 13px;
}

.editor-big-play {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 6;
  width: 46px;
  height: 46px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent-base);
  color: var(--accent-text, #fff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.4);
}

.editor-big-play:hover {
  background: var(--accent-hover);
}

.editor-big-play-icon {
  font-family: "WinUIOnWebIcons";
  font-size: 22px;
  line-height: 1;
  transform: translateX(1px); /* 播放三角视觉居中 */
}

.editor-play-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ctrl-solid-fill, rgba(16, 16, 20, 0.72));
  color: var(--text-tertiary);
  font-size: 15px;
  text-align: center;
  padding: 0 24px;
  pointer-events: none;
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

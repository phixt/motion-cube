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
import { buildCategoryTree, flattenCategoryTree } from "../../data/category";
import { loadLibrary, saveLibrary, upsertTechniqueInLib } from "../../data/libraryStore";
import {
  createTechnique,
  removeKeyframe,
  upsertKeyframe,
  type Easing,
  type StepMapping,
  type Technique,
} from "../../data/technique";
import {
  defaultHandPose,
  FINGER_ORDER,
  type FingerName,
  type HandType,
  type Pose,
} from "../../hand/HandRig";
import { HandRigView } from "../../hand/HandRigView";
import { KeymapController } from "../../input/keymap";
import { invertMoves, parseMoves, splitCompoundMove } from "../../notation/alg";
import { loadEditorKeymap, loadSettings } from "../../settings";
import { renderGrayPanel } from "../../ui/grayPanel";
import {
  applyEasing,
  DEFAULT_FRAME_RATE,
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
const AUTO_PATH_STEP = 15; // 自动路径中间关键帧间隔（帧）
const SNAP_STEP = 1 / 3; // 吸附步长：1/3 块边长（sticker 网格）
// 每动作默认时长（秒）：编辑器默认步时 0.3s（"正常动作"），与 cubing 基准 1s 分离；
// 播放时 tempoScale = 1.0 / 步时，动画精确匹配
const STEP_DEFAULT_SEC = 0.3;
/** 最短单步时长（秒）：时间线总长下限，非定值——步长下探时同步调小 */
const MIN_STEP_SEC = 0.01;
/** frameRate 预设挡位（避免罕见帧数；23.97/59.94 等也可用） */
const FRAME_RATE_PRESETS = [23.97, 24, 29.97, 30, 59.94, 60, 120, 240, 1000] as const;
/** 整体倍速预设（慢放/快放查看） */
const PLAY_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;
const playSpeed = ref(1);
/** 拍：1 拍 = 默认步时（0.3s），随 frameRate 换算帧数 */
const beatFrames = computed(() => Math.round(STEP_DEFAULT_SEC * (tech.value?.frameRate ?? 60)));

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
/** 播放帧累加器：按真实时间累积分数帧，消除逐帧取整漂移（任意帧率下 1 拍 = 0.3s） */
let frameAcc = 0;

/** 播放器整合：公式 step 与手法 stepMapping 帧级同步 */
// cubing 默认单步动画基准时长（tempoScale=1 时 1000ms，见 AlgDuration.defaultDurationForAmount）。
// 之前误设 0.3 导致 tempoScale 校准错误：0.3s 步时配 tempoScale=1 时动画需 1s、只播 0.3s
// 就被下一步 cancel → 执行完"没到位直接跳变"。
const CUBING_MOVE_SECONDS = 1.0;
let formulaMoves: string[] = [];
let stepMoveIndex = 0;

const editorViewEl = ref<HTMLElement | null>(null);
const handTypeSelectEl = ref<HTMLSelectElement | null>(null);
const formulaLabelEl = ref<HTMLElement | null>(null);
const emptyHintEl = ref<HTMLElement | null>(null);
const newNameEl = ref<HTMLInputElement | null>(null);
const tlMetaEl = ref<HTMLElement | null>(null);
const kfFrameEl = ref<HTMLInputElement | null>(null);
const kfEasingEl = ref<HTMLSelectElement | null>(null);
const kfDeleteEl = ref<HTMLButtonElement | null>(null);
const kfPoseXEl = ref<HTMLInputElement | null>(null);
const kfPoseYEl = ref<HTMLInputElement | null>(null);
const kfPoseZEl = ref<HTMLInputElement | null>(null);
const kfPoseRxEl = ref<HTMLInputElement | null>(null);
const kfPoseRyEl = ref<HTMLInputElement | null>(null);
const kfPoseRzEl = ref<HTMLInputElement | null>(null);
/** 手法选择搜索（编辑器侧边栏，复用公式库搜索思路） */
const tecSearch = ref("");
/** 新建手法：关联公式搜索与选中 */
const formulaSearch = ref("");
const selectedFormulaId = ref("");

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
/** 魔方/手显隐（快捷键 C/H + 侧边栏按钮） */
const showCube = ref(true);
const showHand = ref(true);
let grayOverlay: GrayOverlay | null = null;
let grayPanelApi: ReturnType<typeof renderGrayPanel> | null = null;
const maskVisible = ref(false);
let maskTimer: number | null = null;
/** 选中动作块（S1…，支持 Ctrl/Shift 多选）高亮后在下侧设定时长 */
const selectedSteps = ref<number[]>([]);
/** 关键帧编辑面板（左侧边栏顶部；点关键帧箭头/自动建帧时展开） */
const kfPanelOpen = ref(false);
/** 编辑面板常驻：点时间线即展开，仅切换手法/手动关闭才收起 */
const kfPanelVisible = computed(() => kfPanelOpen.value);
/** 侧边栏分组折叠状态（默认全折叠，点标题展开/收起） */
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
/** 公式分类组折叠状态（默认全折叠；点组标题展开/收起，与公式库同步） */
const formulaGroupOpen = ref<Record<string, boolean>>({});
const isFormulaGroupOpen = (label: string): boolean => formulaGroupOpen.value[label] === true;
const toggleFormulaGroup = (label: string): void => {
  formulaGroupOpen.value = { ...formulaGroupOpen.value, [label]: !isFormulaGroupOpen(label) };
};
/** 自动添加关键帧：在无关键帧的帧位置修改姿态数值时自动建帧 */
const autoKf = ref(false);
watch(autoKf, (on) => {
  if (on) kfPanelOpen.value = true; // 自动建帧即进入编辑：展开侧边栏面板
});
const saveFailed = ref(false);
/** 各指关节名（与 rig.fingers[name].joints 顺序一致）与 bend 范围 */
const FINGER_JOINTS: Record<FingerName, string[]> = {
  thumb: ["CMC", "MCP", "IP"],
  index: ["MCP", "PIP", "DIP"],
  middle: ["MCP", "PIP", "DIP"],
  ring: ["MCP", "PIP", "DIP"],
  pinky: ["MCP", "PIP", "DIP"],
};
const FINGER_JOINT_RANGE: Record<FingerName, [number, number]> = {
  thumb: [60, 180], // CMC 可到 60（DEFAULT_BEND_RANGE 90-180，CMC 特例 60-180）
  index: [90, 180],
  middle: [90, 180],
  ring: [90, 180],
  pinky: [90, 180],
};
let rulerSeeking = false;

/** 时间线播放头/轨道 seek：按点击位置换算帧号 */
const seekFromEvent = (clientX: number, track: HTMLElement): void => {
  const rect = track.getBoundingClientRect();
  const total = Math.max(totalFrames.value, minTimelineFrames.value);
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
  e.preventDefault(); // 阻止文本选择/拖拽干扰
  if (playing.value) playing.value = false; // 点轨道停止播放
  kfPanelOpen.value = true; // 点时间线 → 编辑面板常驻（姿态信息跟随播放头）
  // band 上按下即选中（Ctrl/Shift 多选立即生效，不依赖 click 松手）
  const band = (e.target as HTMLElement).closest?.(".tl-step-band");
  if (band) {
    const idx = Number(band.getAttribute("data-step-index") ?? "-1");
    if (idx >= 0) selectStep(idx, e);
  } else if (selectedSteps.value.length > 0) {
    selectedSteps.value = []; // 点空白取消多选
  }
};
const onRulerSeek = (e: PointerEvent): void => {
  // 时间线上方（秒/拍刻度区域）点击跳转
  e.preventDefault();
  if (playing.value) playing.value = false;
  kfPanelOpen.value = true; // 点时间线 → 编辑面板常驻
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

/** 姿态修改统一入口：目标帧有帧则更新；无帧且 autoKf 开启则自动建帧（以当前插值姿态为基底） */
const ensureAutoKfPose = (t2: Technique, frame: number, patch: (pose: Pose) => Pose): Technique => {
  const k2 = t2.keyframes.find((k) => k.frame === frame);
  if (k2) return upsertKeyframe(t2, { ...k2, pose: patch(k2.pose) });
  if (!autoKf.value) return t2;
  const base = previewPose() ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right");
  return upsertKeyframe(t2, { frame, pose: patch(base) });
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
    e.preventDefault(); // 时间线不滚动（普通左右只在时间线上步进）
    stepFrames(e.code === "ArrowRight" ? 1 : -1, e.shiftKey);
    return;
  }
  if (spaceDownAt && performance.now() - spaceDownAt < 600) spaceCombined = true;
};

const totalFrames = computed(() => {
  if (!tech.value) return 0;
  // 允许无关键帧播放：时长取 最后关键帧 / 步骤区间终点 的最大值（下限 = 最短单步 0.01s，
  // 非定值，之后步长下探时同步调 MIN_STEP_SEC 即可）
  const kfLast = tech.value.keyframes.length
    ? tech.value.keyframes[tech.value.keyframes.length - 1].frame
    : 0;
  const stepLast = tech.value.stepMapping.reduce((m, s) => Math.max(m, s.endFrame), 0);
  return Math.max(kfLast, stepLast, minTimelineFrames.value);
});

/** 时间线总长下限（帧）：最短单步 0.01s × frameRate，至少 1 帧 */
const minTimelineFrames = computed(() =>
  Math.max(1, Math.round(MIN_STEP_SEC * (tech.value?.frameRate ?? DEFAULT_FRAME_RATE))),
);

const sortedKeyframes = computed(() =>
  tech.value ? [...tech.value.keyframes].sort((a, b) => a.frame - b.frame) : [],
);

/** 时间线刻度（时间制）：主刻度 1s、次刻度 1/5s，随 frameRate 换算帧号 */
const rulerTicks = computed(() => {
  const fr = tech.value?.frameRate ?? 60;
  const ticks: { frame: number; major: boolean }[] = [];
  const total = totalFrames.value;
  const majorEvery = Math.max(1, Math.round(fr));
  const minorEvery = Math.max(1, Math.round(fr / 5));
  for (let f = 0; f <= total; f++) {
    if (f % majorEvery === 0) ticks.push({ frame: f, major: true });
    else if (f % minorEvery === 0) ticks.push({ frame: f, major: false });
  }
  return ticks;
});

/** 拍网格刻度（每 1 拍一条，0.3s） */
const beatTicks = computed(() => {
  const ticks: { frame: number; beat: number }[] = [];
  const total = totalFrames.value;
  for (let f = 0; f <= total; f += beatFrames.value) {
    ticks.push({ frame: f, beat: beatFrames.value > 0 ? f / beatFrames.value : 0 });
  }
  return ticks;
});

/** 当前编辑目标帧对应的拍（1 拍 = beatFrames 帧；autoKf 跟随播放头） */
const beatOfSelected = computed(() => {
  const frame = shownFrame();
  return frame === null || beatFrames.value <= 0 ? "" : (frame / beatFrames.value).toFixed(2);
});

/** 拍 → 帧号并更新选中关键帧（复用帧号变更语义） */
const onKfBeatChange = (e: Event): void => {
  const src = shownFrame();
  if (!tech.value || src === null) return;
  const beat = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(beat) || beat < 0) {
    renderSelected();
    return;
  }
  const target = Math.round(beat * beatFrames.value);
  onKfFrameChangeFrom(target, src);
};

/** 按秒等比重映射全部帧数据（拍/动作联动：0.3s 的动作帧数随 frameRate 变化，时长不变） */
function rescaleFrames(t2: Technique, oldFr: number, newFr: number): Technique {
  const remap = (frame: number): number => Math.round((frame / oldFr) * newFr);
  return {
    ...t2,
    frameRate: newFr,
    keyframes: t2.keyframes.map((k) => ({ ...k, frame: remap(k.frame) })),
    stepMapping: t2.stepMapping.map((m) => ({
      ...m,
      startFrame: remap(m.startFrame),
      endFrame: remap(m.endFrame),
    })),
    contactTracks: t2.contactTracks.map((c) => ({
      ...c,
      startFrame: remap(c.startFrame),
      endFrame: remap(c.endFrame),
    })),
  };
}

/** 切换 frameRate（预设挡位，最高 1000）：全时间线按秒重映射，避免极高帧率光速完成 */
const onFrameRateChange = (e: Event): void => {
  if (!tech.value) return;
  const fr = Number((e.target as HTMLSelectElement).value);
  if (!Number.isFinite(fr) || fr <= 0) {
    renderAll();
    return;
  }
  const oldFr = tech.value.frameRate;
  if (oldFr === fr) return;
  playing.value = false; // 播放中切换帧率会与步进/魔方状态脱同步，先停止
  const sel = selectedFrame.value;
  const pv = previewFrame.value;
  commit((t2) => rescaleFrames(t2, oldFr, fr));
  // 选中关键帧与播放头保持同一时间位置（帧号按秒等比换算）
  if (sel !== null) selectedFrame.value = Math.round((sel / oldFr) * fr);
  previewFrame.value = Math.round((pv / oldFr) * fr);
  syncCubeToFrame(previewFrame.value);
  renderAll(); // 重渲染面板摘要/数值（selectedFrame 已按新帧率换算）
};

const onKfFrameChangeFrom = (target: number, src: number = shownFrame() ?? -1): void => {
  if (!tech.value || src < 0) return;
  const kf = tech.value.keyframes.find((k) => k.frame === src);
  if (!kf) return;
  commit((t2) => {
    const moved = upsertKeyframe(t2, { ...kf, frame: target });
    return removeKeyframe(moved, src);
  });
  selectedFrame.value = target;
  previewFrame.value = target;
  syncCubeToFrame(target);
  renderAll();
};

const tlWidth = computed(() => `${Math.max(totalFrames.value, minTimelineFrames.value) * pxPerFrame.value}px`);

const stepBands = computed(() => tech.value?.stepMapping ?? []);

const kfDeleteEnabled = computed(() =>
  shownFrame() !== null &&
  !!tech.value?.keyframes.find((k) => k.frame === shownFrame()),
);

/** 手法搜索：名称或关联公式名包含（大小写不敏感；复用公式库搜索思路） */
const filteredTechniques = computed(() => {
  const q = tecSearch.value.trim().toLowerCase();
  if (!q) return lib.value.techniques;
  return lib.value.techniques.filter((x) => {
    if (x.name.toLowerCase().includes(q)) return true;
    const f = lib.value.formulas.find((fm) => fm.id === x.formulaId);
    return !!f?.name.toLowerCase().includes(q);
  });
});

/** 新建手法：公式搜索（名称或公式串包含） */
const filteredNewFormulas = computed(() => {
  const q = formulaSearch.value.trim().toLowerCase();
  if (!q) return lib.value.formulas;
  return lib.value.formulas.filter((f) => {
    return f.name.toLowerCase().includes(q) || f.moves.toLowerCase().includes(q);
  });
});

/** 新建手法：公式按分类树渲染（1LLL 展开 → 直属公式 + 子分类 ZBLL 组，层级缩进） */
const formulaGroupRows = computed(() => {
  const nodes = buildCategoryTree(
    lib.value.categories,
    filteredNewFormulas.value,
    (f) => f.categoryId,
    t("editor.formulaNone"),
  );
  return flattenCategoryTree(nodes, isFormulaGroupOpen, (f) => f.id);
});

const handTypeOptions = [
  { value: "right", label: t("editor.handRight") },
  { value: "left", label: t("editor.handLeft") },
];

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

/** 编辑面板目标帧：始终跟随播放头（点时间线/播放/步进即查看该帧姿态） */
function shownFrame(): number | null {
  return tech.value ? previewFrame.value : null;
}

/** 编辑面板显示姿态：播放头处插值姿态（含端点关键帧）；无关键帧时回退默认手位，
 *  保证数值监控常驻显示（details 已并入面板） */
function shownPose(): Pose | null {
  if (shownFrame() === null) return null;
  return (
    previewPose() ??
    defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right")
  );
}

function renderSelected(keepInputs = false): void {
  const frame = shownFrame();
  const kf = frame === null ? null : tech.value?.keyframes.find((k) => k.frame === frame);
  const displayPose = shownPose();
  if (kfFrameEl.value) kfFrameEl.value.value = frame !== null ? String(frame) : "";
  if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
  const pos = displayPose?.palm.transform.position;
  // 坐标输入过程中不回写 value（对齐标定页手感，连续输入不被打断）
  if (!keepInputs) {
    if (kfPoseXEl.value) kfPoseXEl.value.value = pos ? pos.x.toFixed(2) : "";
    if (kfPoseYEl.value) kfPoseYEl.value.value = pos ? pos.y.toFixed(2) : "";
    if (kfPoseZEl.value) kfPoseZEl.value.value = pos ? pos.z.toFixed(2) : "";
    const rot = displayPose ? poseRotationDeg(displayPose) : null;
    if (kfPoseRxEl.value) kfPoseRxEl.value.value = rot ? rot.x.toFixed(0) : "";
    if (kfPoseRyEl.value) kfPoseRyEl.value.value = rot ? rot.y.toFixed(0) : "";
    if (kfPoseRzEl.value) kfPoseRzEl.value.value = rot ? rot.z.toFixed(0) : "";
    for (const name of FINGER_ORDER) {
      const arr = displayPose?.bends[name] ?? [];
      FINGER_JOINTS[name].forEach((_, j) => {
        const el = document.getElementById(`kf-bend-${name}-${j}`) as HTMLInputElement | null;
        if (el) el.value = arr[j] !== undefined ? String(Math.round(arr[j])) : "";
      });
    }
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
  const pose = shownPose();
  // 面板常驻时：帧号/缓动/删除/数值全部跟随播放头（姿态信息并入帧编辑器；
  // 正在输入的数值框不覆盖）
  if (kfPanelVisible.value) {
    const frame = previewFrame.value;
    const kf = tech.value?.keyframes.find((k) => k.frame === frame) ?? null;
    if (kfFrameEl.value) kfFrameEl.value.value = String(frame);
    if (kfEasingEl.value) kfEasingEl.value.value = kf?.easing ?? "linear";
    if (kfDeleteEl.value) kfDeleteEl.value.disabled = !kf;
    if (pose) {
      const pos = pose.palm.transform.position;
      const rot = poseRotationDeg(pose);
      const active = document.activeElement;
      const sync = (el: HTMLInputElement | null, v: string): void => {
        if (el && active !== el) el.value = v;
      };
      sync(kfPoseXEl.value, pos.x.toFixed(2));
      sync(kfPoseYEl.value, pos.y.toFixed(2));
      sync(kfPoseZEl.value, pos.z.toFixed(2));
      sync(kfPoseRxEl.value, rot.x.toFixed(0));
      sync(kfPoseRyEl.value, rot.y.toFixed(0));
      sync(kfPoseRzEl.value, rot.z.toFixed(0));
      for (const name of FINGER_ORDER) {
        const arr = pose.bends[name] ?? [];
        FINGER_JOINTS[name].forEach((_, j) => {
          const el = document.getElementById(`kf-bend-${name}-${j}`) as HTMLInputElement | null;
          if (el && active !== el) el.value = arr[j] !== undefined ? String(Math.round(arr[j])) : "";
        });
      }
    }
  }
  if (handView) {
  handView.setPose(pose ?? defaultHandPose((handTypeSelectEl.value?.value as HandType) ?? "right"));
  }
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

function selectTech(id: string): void {
  selectedFrame.value = null;
  previewFrame.value = 0;
  kfPanelOpen.value = false; // 切换手法 → 收起编辑面板（用户指定唯一关闭途径之一）
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

/** 步进时长校准：让 cubing 单步动画时长 = stepMapping 区间时长 ÷ 倍速
 * （整体倍速同时作用于播放头推进与魔方动画，慢放/快放一致不跳变） */
function syncStepSpeed(): void {
  if (!tech.value) return;
  const m0 = tech.value.stepMapping[0];
  if (!m0) return;
  const stepSec = (m0.endFrame - m0.startFrame) / tech.value.frameRate;
  if (stepSec > 0) player?.setSpeed((CUBING_MOVE_SECONDS / stepSec) * playSpeed.value);
}

/** 切换整体倍速：立即校准魔方动画速度（播放中亦生效，下一步起匹配） */
const onPlaySpeedChange = (e: Event): void => {
  const v = Number((e.target as HTMLSelectElement).value);
  if (!Number.isFinite(v) || v <= 0) {
    renderAll();
    return;
  }
  playSpeed.value = v;
  if (playing.value) syncStepSpeed();
};

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

const onHandTypeChange = (e: Event): void => {
  handView?.setHandType((e.target as HTMLSelectElement).value as HandType);
  renderPreview(); // 默认手位随手型更新（左右手镜像位置/朝向）
};

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
  const created = createTechnique({ name, formulaId });
  lib.value = upsertTechniqueInLib(lib.value, created);
  saveLibrary(lib.value);
  if (newNameEl.value) newNameEl.value.value = "";
  selectTech(created.id);
  statusText.value = t("editor.saved");
};

const onKfFrameChange = (e: Event): void => {
  const src = shownFrame();
  if (!tech.value || src === null) return;
  const target = Number((e.target as HTMLInputElement).value);
  if (!Number.isInteger(target) || target < 0) {
    statusText.value = t("editor.kfFail", { error: t("editor.frameInvalid") });
    renderSelected();
    return;
  }
  const kf = tech.value.keyframes.find((k) => k.frame === src);
  if (!kf) return;
  commit((t2) => {
    const moved = upsertKeyframe(t2, { ...kf, frame: target });
    return removeKeyframe(moved, src);
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
  const src = shownFrame();
  if (!tech.value || src === null) return;
  commit((t2) => removeKeyframe(t2, src));
  selectedFrame.value = null;
  renderAll();
};

/** 姿态坐标编辑（手掌位置 X/Y/Z；吸附开启时按 1/3 块边长取整） */
const onPoseInput = (e: Event, axis: "x" | "y" | "z"): void => {
  if (!tech.value) return;
  const target = previewFrame.value; // 编辑目标 = 播放头帧（所见即所得）
  const hasKf = tech.value.keyframes.some((k) => k.frame === target);
  if (!hasKf && !autoKf.value) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  const raw = (e.target as HTMLInputElement).value;
  let v = Number(raw);
  if (!Number.isFinite(v)) return;
  if (snapOn.value) v = Math.round(v / SNAP_STEP) * SNAP_STEP;
  commit((t2) => {
    return ensureAutoKfPose(t2, target, (pose) => ({
      ...pose,
      palm: {
        ...pose.palm,
        transform: {
          ...pose.palm.transform,
          position: { ...pose.palm.transform.position, [axis]: v },
        },
      },
    }));
  }, true);
  if (autoKf.value && selectedFrame.value !== target) {
    selectedFrame.value = target;
    renderAll();
  }
};

/** 手掌三方向旋转（欧拉角，度）：三输入合成为四元数写入关键帧 */
const onPoseRotInput = (): void => {
  if (!tech.value) return;
  const target = previewFrame.value; // 编辑目标 = 播放头帧
  const hasKf = tech.value.keyframes.some((k) => k.frame === target);
  if (!hasKf && !autoKf.value) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  const rx = Number(kfPoseRxEl.value?.value ?? "0");
  const ry = Number(kfPoseRyEl.value?.value ?? "0");
  const rz = Number(kfPoseRzEl.value?.value ?? "0");
  if (![rx, ry, rz].every((v) => Number.isFinite(v))) return;
  const q = new Quaternion().setFromEuler(new Euler(degToRad(rx), degToRad(ry), degToRad(rz)));
  commit((t2) => {
    return ensureAutoKfPose(t2, target, (pose) => ({
      ...pose,
      palm: {
        ...pose.palm,
        transform: {
          ...pose.palm.transform,
          quaternion: { w: q.w, x: q.x, y: q.y, z: q.z },
        },
      },
    }));
  }, true);
  if (autoKf.value && selectedFrame.value !== target) {
    selectedFrame.value = target;
    renderAll();
  }
};

/** 手指关节角度（bend，180=伸直）：目标帧更新，autoKf 空白帧自动建帧 */
const onBendInput = (e: Event, name: FingerName, j: number): void => {
  if (!tech.value) return;
  const target = previewFrame.value; // 编辑目标 = 播放头帧
  const hasKf = tech.value.keyframes.some((k) => k.frame === target);
  if (!hasKf && !autoKf.value) {
    statusText.value = t("editor.poseNeedKf");
    return;
  }
  let v = Number((e.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  const [lo, hi] = FINGER_JOINT_RANGE[name];
  v = Math.min(hi, Math.max(lo, v));
  commit(
    (t2) =>
      ensureAutoKfPose(t2, target, (pose) => {
        const arr = [...(pose.bends[name] ?? [])];
        arr[j] = v;
        return { ...pose, bends: { ...pose.bends, [name]: arr } };
      }),
    true,
  );
  if (autoKf.value && selectedFrame.value !== target) {
    selectedFrame.value = target;
    renderAll();
  }
};

const onKfAdd = (): void => {
  if (!tech.value) return;
  const target = previewFrame.value; // 添加目标 = 当前播放头帧（帧号输入已随播放头，不再重复）
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
      // 倒放：从停止位置继续；在末尾或开头时从头（reverseStart）倒放
      if (previewFrame.value >= totalFrames.value || previewFrame.value <= 0) {
        setReverseStart();
        previewFrame.value = totalFrames.value;
        stepMoveIndex = 0;
        moveCursor = 0;
        revApplied = tech.value.stepMapping.length;
      }
    } else {
      // 正放：从停止位置继续；在开头或播放完（末尾）时从头设起始态
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

// 切换循环/倒放时强制刷新（停止 + 重置），避免方向切换造成的状态错乱
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
    saveFailed.value = false;
  } catch (e) {
    statusText.value = t("editor.saveFail", { error: e instanceof Error ? e.message : String(e) });
    saveFailed.value = true;
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

/** 标灰组折叠 + 面板显隐联动（首次展开时懒初始化面板） */
const onToggleGrayGroup = (): void => {
  toggleGroup("gray");
  toggleGrayPanel();
};

const toggleGrayKind = (): void => {
  grayKind.value = grayKind.value === "mutable" ? "immutable" : "mutable";
};

const selectKf = (frame: number): void => {
  selectedFrame.value = frame;
  previewFrame.value = frame;
  kfPanelOpen.value = true; // 点关键帧箭头 → 展开侧边栏编辑面板
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
      frameAcc = 0;
      return;
    }
    // 精度解耦：帧累加器按真实时间推进（dt × frameRate × 倍速），任意帧率/倍速下
    // 播放速度恒定；1 拍 = 0.3s 的动作在 60fps 为 18 帧、1000fps 为 300 帧，
    // 真实时长始终一致（倍速 0.25x 慢放、4x 快放）。
    const now = performance.now();
    const dtSec = lastTickAt ? (now - lastTickAt) / 1000 : 1 / 60;
    lastTickAt = now;
    frameAcc += dtSec * tech.value.frameRate * playSpeed.value;
    const stepFrames = Math.floor(frameAcc);
    frameAcc -= stepFrames;
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
    <div class="editor-layout">
      <!-- 左侧侧边栏（PS 风格）：手法 / 手 / 标灰 / 时间线 -->
      <aside class="editor-sidebar">
        <div v-show="kfPanelVisible" ref="kfPanelEl" id="kf-edit-panel" class="kf-edit-panel sb-kf-panel">
          <div class="kf-edit-head">
            <WinTextBlock class="editor-label" :Text="t('editor.kfEdit')" FontSize="12" />
            <WinButton id="kf-panel-close" :Content="t('editor.stepDone')" @Click="kfPanelOpen = false" />
          </div>
          <div class="editor-kf-row">
            <WinTextBlock class="editor-label" :Text="t('editor.frame')" />
            <input id="kf-frame" ref="kfFrameEl" type="number" min="0" step="1" class="native-input num-input" @change="onKfFrameChange" />
            <WinTextBlock class="editor-label" :Text="t('editor.beat')" />
            <input id="kf-frame-beat" type="number" min="0" step="0.01" class="native-input num-input" :value="beatOfSelected" @change="onKfBeatChange" />
            <WinTextBlock class="editor-label" :Text="t('editor.easing')" />
            <select id="kf-easing" ref="kfEasingEl" class="native-select" @change="onKfEasingChange">
              <option value="linear">linear</option>
              <option value="easeIn">easeIn</option>
              <option value="easeOut">easeOut</option>
              <option value="easeInOut">easeInOut</option>
            </select>
            <WinButton id="kf-delete" ref="kfDeleteEl" class="del" :Content="t('editor.deleteKf')" :IsEnabled="kfDeleteEnabled" @Click="onKfDelete" />
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
            <div class="finger-joints">
              <WinTextBlock class="editor-label" :Text="t('editor.fingers')" FontSize="12" />
              <div v-for="name in FINGER_ORDER" :key="name" class="finger-row">
                <span class="finger-name">{{ t(`hand.finger${name[0].toUpperCase()}${name.slice(1)}`) }}</span>
                <label v-for="(jname, j) in FINGER_JOINTS[name]" :key="j" class="pose-axis">
                  {{ jname }}
                  <input
                    :id="`kf-bend-${name}-${j}`"
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
                v-for="t in filteredTechniques"
                :key="t.id"
                class="tec-item"
                :class="{ active: tech?.id === t.id }"
                @click="selectTech(t.id)">{{ t.name }}</button>
              <p v-if="filteredTechniques.length === 0" class="meta list-empty">{{ t("editor.searchEmpty") }}</p>
            </div>
            <span id="tec-formula" ref="formulaLabelEl" class="meta"></span>
            <p id="editor-empty" ref="emptyHintEl" class="page-note" hidden>{{ t("editor.empty") }}</p>
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
          <button class="sb-group-head" @click="toggleGroup('hand')">
            <span>{{ t("editor.handType") }}</span>
            <span class="sb-group-caret">{{ groupOpen.hand ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.hand" class="sb-group-body">
            <select id="view-hand" ref="handTypeSelectEl" class="native-select" @change="onHandTypeChange">
              <option v-for="opt in handTypeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
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
            <WinTextBlock class="page-note" :Text="t('editor.toggleHint')" FontSize="11" />
          </div>
        </div>

        <div class="sb-group">
          <button class="sb-group-head" @click="toggleGroup('startState')">
            <span>{{ t("editor.startState") }}</span>
            <span class="sb-group-caret">{{ groupOpen.startState ? "\u25BE" : "\u25B8" }}</span>
          </button>
          <div v-show="groupOpen.startState" class="sb-group-body">
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
            :class="{ failed: saveFailed }"
            :title="t('editor.save')"
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

        <!-- 时间线（默认显示在 3D 视图下方） -->
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
          <p id="tl-meta" ref="tlMetaEl" class="page-note"></p>
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
  min-width: 0; /* 面板内容（开关/输入行）不撑宽侧边栏，超出走内部滚动/换行 */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sb-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 6px);
  background: var(--ctrl-fill-default);
}

.sb-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
}

.sb-group-head:hover {
  color: var(--accent-base);
}

.sb-group-caret {
  color: var(--text-tertiary);
  font-size: 12px;
}

.sb-group-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.save-status {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 7;
  color: var(--SystemFillColorSuccessBrush, #0f7b0f);
  font-size: 13px;
  pointer-events: none;
}

.section-title {
  display: block;
  margin: 22px 0 8px;
}

.editor-picker,
.editor-view-tools,
.editor-new,
.editor-kf-row {
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
  flex-wrap: wrap;
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

.tl-tick-beat {
  position: absolute;
  top: 0;
  width: 1px;
  height: 100%;
  background: var(--stroke-divider, rgba(128, 128, 138, 0.28));
  font-size: 9px;
  line-height: 10px;
  color: var(--text-tertiary);
  padding-left: 3px;
  white-space: nowrap;
  pointer-events: none;
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

.sb-kf-panel {
  margin-top: 0;
}

.sb-kf-panel .pose-edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.sb-kf-panel .pose-edit-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sb-kf-panel .pose-axis {
  color: var(--text-tertiary);
  font-size: 11px;
  gap: 3px;
}

.sb-kf-panel .num-input {
  width: 54px;
  min-height: 22px;
  padding: 1px 5px;
  font-size: 12px;
}

.sb-kf-panel .finger-row {
  gap: 6px;
}

.sb-kf-panel .finger-name {
  font-size: 11px;
  min-width: 30px;
}

.kf-add-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--stroke-divider);
}

.tec-list,
.formula-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 190px;
  overflow-y: auto;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 4px);
  padding: 4px;
}

.formula-group-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 8px;
  border: none;
  background: transparent;
  font-size: 11px;
  line-height: 1.5;
  font-family: inherit;
  color: var(--text-tertiary);
  cursor: pointer;
  border-top: 1px solid var(--stroke-divider);
  margin-top: 2px;
}

.formula-group-label:hover {
  color: var(--accent-base);
}

.formula-group-label:first-child {
  border-top: none;
  margin-top: 0;
}

.tec-item {
  display: flex;
  align-items: center;
  text-align: left;
  padding: 6px 8px;
  min-height: 34px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tec-item:hover {
  background: var(--ctrl-fill-secondary, rgba(128, 128, 138, 0.14));
}

.tec-item.active {
  background: var(--accent-base);
  color: var(--accent-text, #fff);
}

.list-empty {
  padding: 4px 8px;
}

.kf-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.finger-joints {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.finger-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.finger-name {
  min-width: 44px;
  font-size: 13px;
  color: var(--text-secondary);
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

.editor-save-btn {
  position: absolute;
  right: 12px;
  bottom: 66px; /* 播放按钮正上方（同宽 46px，间隔 8px） */
  z-index: 6;
  width: 46px;
  height: 46px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--SystemFillColorSuccessBrush, #0f7b0f); /* 与播放 accent 异色 */
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);
}

html.theme-dark .editor-save-btn:hover {
  background: #4ade80; /* 暗色：饱和亮绿 */
}

html.theme-light .editor-save-btn:hover {
  background: #15803d; /* 浅色：饱和深绿 */
}

.editor-save-btn.failed {
  background: #c42b1c; /* 保存失败变红 */
}

.editor-save-icon {
  font-family: "WinUIOnWebIcons";
  font-size: 18px;
  line-height: 1;
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

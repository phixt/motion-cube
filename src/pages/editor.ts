/**
 * 动画编辑器骨架（docs/todo.md：时间线编辑器骨架）。
 * 稀疏关键帧 → 60fps 补帧预览：手法选择、时间线轨道（标尺/关键帧/步骤区间带）、
 * 选中关键帧编辑（帧号/缓动/删除）、补帧滑杆播放与插值读数、保存回库。
 * 姿态本身的可视化编辑（3D 手模型拖拽）与坐标吸附等在后续里程碑。
 */
import { defaultHandPose, FINGER_ORDER, type HandType, type Pose } from "../hand/HandRig";
import { HandRigView } from "../hand/HandRigView";
import { CubePlayer } from "../cube/CubePlayer";
import { loadLibrary, saveLibrary, upsertTechniqueInLib } from "../data/libraryStore";
import {
  createTechnique,
  removeKeyframe,
  upsertKeyframe,
  type Easing,
  type Technique,
} from "../data/technique";
import {
  applyEasing,
  interpolatePose,
  keyframeSegment,
  type EasingFn,
} from "../timeline/Timeline";
import { t } from "../i18n";
import "../styles/editor.css";
import "../styles/pages.css";
import { el } from "../ui/dom";
import { navBar } from "../ui/nav";

const PX_PER_FRAME = 2; // 时间线横向缩放：1 秒 = 120px
const PREVIEW_SAMPLE_STEP = 15; // 采样表间隔（帧）

export function renderEditorPage(root: HTMLElement): void {
  root.innerHTML = "";
  const page = el("div", "", "page");
  page.prepend(navBar("editor"));

  const title = el("h1", t("editor.title"));
  const status = el("span", "", "save-status");
  status.id = "editor-status";
  page.append(title, status);

  let lib = loadLibrary();
  let tech: Technique | null = null;
  let selectedFrame: number | null = null;
  let playing = false;
  let previewFrame = 0;

  // ---- 手法选择 / 新建 ----
  const pickerRow = el("div", "", "editor-picker");
  const tecSelect = el("select") as HTMLSelectElement;
  tecSelect.id = "tec-select";
  const formulaLabel = el("span", "", "meta");
  formulaLabel.id = "tec-formula";
  pickerRow.append(el("label", t("editor.technique")), tecSelect, formulaLabel);
  const emptyHint = el("p", t("editor.empty"), "page-note");
  emptyHint.id = "editor-empty";
  emptyHint.hidden = true;

  // ---- 3D 视口（魔方 + 手）----
  const viewSection = el("div", "", "editor-section");
  const viewHeading = el("h2", t("editor.view"));
  const viewTools = el("div", "", "editor-view-tools");
  const handTypeSelect = el("select") as HTMLSelectElement;
  handTypeSelect.id = "view-hand";
  for (const [v, label] of [
    ["left", t("editor.handLeft")],
    ["right", t("editor.handRight")],
  ] as const) {
    const opt = el("option", label);
    opt.value = v;
    handTypeSelect.appendChild(opt);
  }
  const viewContainer = el("div", "", "editor-view");
  viewContainer.id = "editor-view";
  const viewHint = el("p", t("editor.viewHint"), "page-note");
  viewTools.append(el("label", t("editor.handType")), handTypeSelect);
  viewSection.append(viewHeading, viewTools, viewContainer, viewHint);

  const newRow = el("div", "", "editor-new");
  const newName = el("input") as HTMLInputElement;
  newName.id = "tec-new-name";
  newName.placeholder = t("editor.newName");
  const newFormula = el("select") as HTMLSelectElement;
  newFormula.id = "tec-new-formula";
  const btnNew = el("button", t("editor.newAdd"), "primary") as HTMLButtonElement;
  btnNew.id = "tec-new-add";
  newRow.append(newName, newFormula, btnNew);

  // ---- 时间线 ----
  const tlSection = el("div", "", "editor-section");
  const tlHeading = el("h2", t("editor.timeline"));
  const tlWrap = el("div", "", "tl-wrap");
  const tlRuler = el("div", "", "tl-ruler");
  tlRuler.id = "tl-ruler";
  const tlTrack = el("div", "", "tl-track");
  tlTrack.id = "tl-track";
  const tlMeta = el("p", "", "page-note");
  tlMeta.id = "tl-meta";
  tlWrap.append(tlRuler, tlTrack);
  tlSection.append(tlHeading, tlWrap, tlMeta);

  // ---- 选中关键帧 ----
  const kfSection = el("div", "", "editor-section");
  const kfHeading = el("h2", t("editor.selected"));
  const kfFrameInput = el("input") as HTMLInputElement;
  kfFrameInput.id = "kf-frame";
  kfFrameInput.type = "number";
  kfFrameInput.min = "0";
  kfFrameInput.step = "1";
  const kfEasing = el("select") as HTMLSelectElement;
  kfEasing.id = "kf-easing";
  for (const e of ["linear", "easeIn", "easeOut", "easeInOut"] as const) {
    const opt = el("option", e);
    opt.value = e;
    kfEasing.appendChild(opt);
  }
  const btnKfDelete = el("button", t("editor.deleteKf"), "del") as HTMLButtonElement;
  btnKfDelete.id = "kf-delete";
  const kfPose = el("pre", "", "kf-pose");
  kfPose.id = "kf-pose";
  kfSection.append(
    kfHeading,
    el("label", t("editor.frame")),
    kfFrameInput,
    el("label", t("editor.easing")),
    kfEasing,
    btnKfDelete,
    kfPose,
  );

  // ---- 添加关键帧 ----
  const addRow = el("div", "", "editor-add");
  const addFrameInput = el("input") as HTMLInputElement;
  addFrameInput.id = "kf-add-frame";
  addFrameInput.type = "number";
  addFrameInput.min = "0";
  addFrameInput.step = "1";
  addFrameInput.value = "30";
  const btnAddKf = el("button", t("editor.addKf"), "primary") as HTMLButtonElement;
  btnAddKf.id = "kf-add";
  addRow.append(el("label", t("editor.frame")), addFrameInput, btnAddKf);
  const addHint = el("p", t("editor.addKfHint"), "page-note");

  // ---- 补帧预览 ----
  const pvSection = el("div", "", "editor-section");
  const pvHeading = el("h2", t("editor.preview"));
  const pvControls = el("div", "", "editor-pv-controls");
  const btnPlay = el("button", t("editor.play"), "primary") as HTMLButtonElement;
  btnPlay.id = "pv-play";
  const pvSlider = el("input") as HTMLInputElement;
  pvSlider.id = "pv-slider";
  pvSlider.type = "range";
  pvSlider.min = "0";
  pvSlider.step = "1";
  const pvReadout = el("span", "", "meta");
  pvReadout.id = "pv-readout";
  pvControls.append(btnPlay, pvSlider, pvReadout);
  const pvPose = el("pre", "", "kf-pose");
  pvPose.id = "pv-pose";
  const pvTableWrap = el("div", "", "pv-table-wrap");
  const pvTable = el("table", "", "pv-table");
  pvTable.id = "pv-table";
  pvTableWrap.appendChild(pvTable);
  pvSection.append(pvHeading, pvControls, pvPose, pvTableWrap);

  // ---- 保存 ----
  const btnSave = el("button", t("editor.save"), "primary") as HTMLButtonElement;
  btnSave.id = "editor-save";

  page.append(
    pickerRow,
    emptyHint,
    viewSection,
    newRow,
    tlSection,
    kfSection,
    addRow,
    addHint,
    pvSection,
    btnSave,
  );
  root.appendChild(page);

  // 3D：魔方（显示关联公式）+ 手（跟随预览帧/选中关键帧姿态）
  const player = new CubePlayer(viewContainer, { cameraDistance: 8 });
  const handView = new HandRigView(player);
  void handView.init();
  (globalThis as { __motionCubeEditor?: unknown }).__motionCubeEditor = { player, handView };

  // ---------- 逻辑 ----------
  function setStatus(text: string) {
    status.textContent = text;
  }

  function totalFrames(): number {
    if (!tech || tech.keyframes.length === 0) return 0;
    return Math.max(tech.keyframes[tech.keyframes.length - 1].frame, 60);
  }

  function renderPicker() {
    tecSelect.replaceChildren();
    const none = el("option", t("library.noneCategory"));
    none.value = "";
    tecSelect.appendChild(none);
    for (const t2 of lib.techniques) {
      const opt = el("option", t2.name);
      opt.value = t2.id;
      tecSelect.appendChild(opt);
    }
    tecSelect.value = tech?.id ?? "";
    formulaLabel.textContent = tech
      ? `${t("editor.formula")}: ${lib.formulas.find((f) => f.id === tech!.formulaId)?.name ?? "?"}`
      : "";
    emptyHint.hidden = lib.techniques.length > 0;

    newFormula.replaceChildren();
    const noneF = el("option", t("library.noneCategory"));
    noneF.value = "";
    newFormula.appendChild(noneF);
    for (const f of lib.formulas) {
      const opt = el("option", f.name);
      opt.value = f.id;
      newFormula.appendChild(opt);
    }
  }

  /** 姿态摘要：各指 PIP（拇指 IP）等数值 */
  function poseSummary(pose: Pose): string {
    const lines = FINGER_ORDER.map((name) => {
      const arr = pose.bends[name];
      const joint = name === "thumb" ? 2 : 1; // PIP / 拇指 IP
      const tip = name === "thumb" ? 1 : 2; // 拇指 MCP / 其余 DIP
      return `${name.padEnd(6)} ${jointName(name)}:${Math.round(arr[joint] ?? 0)}°  DIP/MCP:${Math.round(arr[tip] ?? 0)}°`;
    });
    lines.push(`thumbCMC ab:${Math.round(pose.thumbCMC.abduction)} rot:${Math.round(pose.thumbCMC.rotation)}`);
    lines.push(
      `palm pos (${pose.palm.transform.position.x.toFixed(2)}, ${pose.palm.transform.position.y.toFixed(2)}, ${pose.palm.transform.position.z.toFixed(2)})`,
    );
    lines.push(`contacts: ${pose.contacts.length ? pose.contacts.map((c) => `${c.finger}→${c.target}`).join(", ") : "—"}`);
    return lines.join("\n");
  }

  function jointName(name: string): string {
    return name === "thumb" ? "IP" : "PIP";
  }

  function renderRuler(total: number) {
    tlRuler.replaceChildren();
    tlRuler.style.width = `${Math.max(total, 60) * PX_PER_FRAME}px`;
    for (let f = 0; f <= total; f++) {
      if (f % 60 === 0) {
        const tick = el("span", `${(f / 60).toFixed(1)}s`, "tl-tick-major");
        tick.style.left = `${f * PX_PER_FRAME}px`;
        tlRuler.appendChild(tick);
      } else if (f % 15 === 0) {
        const tick = el("span", "", "tl-tick-minor");
        tick.style.left = `${f * PX_PER_FRAME}px`;
        tlRuler.appendChild(tick);
      }
    }
  }

  function renderTrack() {
    tlTrack.replaceChildren();
    const total = totalFrames();
    tlTrack.style.width = `${Math.max(total, 60) * PX_PER_FRAME}px`;
    if (!tech) return;
    // 步骤区间带
    for (const m of tech.stepMapping) {
      const band = el("span", `S${m.stepIndex + 1}`, "tl-step-band");
      band.style.left = `${m.startFrame * PX_PER_FRAME}px`;
      band.style.width = `${Math.max((m.endFrame - m.startFrame) * PX_PER_FRAME, 8)}px`;
      tlTrack.appendChild(band);
    }
    // 关键帧标记
    for (const kf of tech.keyframes) {
      const mark = el("button", "", "tl-kf") as HTMLButtonElement;
      mark.dataset.frame = String(kf.frame);
      mark.style.left = `${kf.frame * PX_PER_FRAME - 6}px`;
      if (selectedFrame === kf.frame) mark.classList.add("selected");
      mark.title = `${kf.frame} (${(kf.frame / tech.frameRate).toFixed(2)}s)`;
      mark.addEventListener("click", () => {
        selectedFrame = kf.frame;
        previewFrame = kf.frame;
        renderAll();
      });
      tlTrack.appendChild(mark);
    }
  }

  function renderMeta() {
    const total = totalFrames();
    tlMeta.textContent = tech
      ? `${t("editor.kfCount", { n: tech.keyframes.length })} ｜ ${t("editor.totalFrames", {
          n: total,
          sec: (total / tech.frameRate).toFixed(2),
        })} ｜ ${t("editor.steps", { n: tech.stepMapping.length })}`
      : "";
  }

  function renderSelected() {
    const kf = selectedFrame === null ? null : tech?.keyframes.find((k) => k.frame === selectedFrame);
    kfFrameInput.value = kf ? String(kf.frame) : "";
    kfEasing.value = kf?.easing ?? "linear";
    kfPose.textContent = kf ? poseSummary(kf.pose) : tech ? t("editor.noKfSelected") : "";
    btnKfDelete.disabled = !kf;
  }

  function renderPreview() {
    const total = totalFrames();
    pvSlider.max = String(Math.max(total, 0));
    pvSlider.value = String(Math.min(previewFrame, total));
    pvReadout.textContent = tech
      ? t("editor.frameOf", {
          frame: previewFrame,
          total,
          sec: (previewFrame / tech.frameRate).toFixed(2),
        })
      : "";
    // 插值姿态：读数 + 3D 手驱动
    const pose = previewPose();
    pvPose.textContent = pose ? poseSummary(pose) : t("editor.needKf");
    handView.setPose(pose);
    renderPreviewTable(total);
  }

  /** 当前预览帧的插值姿态（<2 关键帧时取唯一帧或 null） */
  function previewPose(): Pose | null {
    if (!tech || tech.keyframes.length === 0) return null;
    if (tech.keyframes.length === 1) return tech.keyframes[0].pose;
    const sorted = [...tech.keyframes].sort((a, b) => a.frame - b.frame);
    const seg = keyframeSegment(sorted, previewFrame);
    if (!seg) return sorted[0].pose;
    if (seg.a === seg.b) return seg.a.pose;
    const eased = applyEasing((seg.a.easing ?? "linear") as EasingFn, seg.local);
    return interpolatePose(seg.a.pose, seg.b.pose, eased);
  }

  function renderPreviewTable(total: number) {
    pvTable.replaceChildren();
    if (!tech || tech.keyframes.length < 2) {
      const tr = el("tr");
      tr.appendChild(el("td", t("editor.needKf")));
      pvTable.appendChild(tr);
      return;
    }
    const thead = el("tr");
    for (const h of [t("editor.frame"), t("editor.sec"), "IP/PIP(°)", "DIP/MCP(°)", "contact"]) {
      thead.appendChild(el("th", h));
    }
    pvTable.appendChild(thead);
    const sorted = [...tech.keyframes].sort((a, b) => a.frame - b.frame);
    for (let f = 0; f <= total; f += PREVIEW_SAMPLE_STEP) {
      const seg = keyframeSegment(sorted, f);
      if (!seg) continue;
      const pose =
        seg.a === seg.b
          ? seg.a.pose
          : interpolatePose(seg.a.pose, seg.b.pose, applyEasing((seg.a.easing ?? "linear") as EasingFn, seg.local));
      const ip = pose.bends.index[1] ?? 0;
      const dip = pose.bends.index[2] ?? 0;
      const row = el("tr");
      row.append(
        el("td", String(f)),
        el("td", (f / tech.frameRate).toFixed(2)),
        el("td", Math.round(ip).toString()),
        el("td", Math.round(dip).toString()),
        el("td", pose.contacts.length ? `${pose.contacts[0].finger}→${pose.contacts[0].target}` : "—"),
      );
      pvTable.appendChild(row);
    }
  }

  function renderAll() {
    renderPicker();
    renderRuler(totalFrames());
    renderTrack();
    renderMeta();
    renderSelected();
    renderPreview();
  }

  function selectTech(id: string) {
    selectedFrame = null;
    previewFrame = 0;
    tech = lib.techniques.find((x) => x.id === id) ?? null;
    updateCubeAlg();
    renderAll();
  }

  function updateCubeAlg() {
    const f = tech ? lib.formulas.find((x) => x.id === tech!.formulaId) : undefined;
    player.setMoves(f?.moves ?? "");
  }

  function commit(fn: (t: Technique) => Technique) {
    if (!tech) return;
    try {
      tech = fn(tech);
      renderAll();
    } catch (e) {
      setStatus(t("editor.kfFail", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  tecSelect.addEventListener("change", () => selectTech(tecSelect.value));

  handTypeSelect.addEventListener("change", () => {
    handView.setHandType(handTypeSelect.value as HandType);
  });

  btnNew.addEventListener("click", () => {
    const name = newName.value.trim();
    const formulaId = newFormula.value;
    if (!name) {
      setStatus(t("editor.newFail"));
      return;
    }
    if (!formulaId) {
      setStatus(t("editor.newFailFormula"));
      return;
    }
    const created = createTechnique({ name, formulaId });
    lib = upsertTechniqueInLib(lib, created);
    saveLibrary(lib);
    newName.value = "";
    selectTech(created.id);
    updateCubeAlg();
    setStatus(t("editor.saved"));
  });

  kfFrameInput.addEventListener("change", () => {
    if (!tech || selectedFrame === null) return;
    const target = Number(kfFrameInput.value);
    if (!Number.isInteger(target) || target < 0) {
      setStatus(t("editor.kfFail", { error: t("editor.frameInvalid") }));
      renderSelected();
      return;
    }
    const kf = tech.keyframes.find((k) => k.frame === selectedFrame);
    if (!kf) return;
    commit((t2) => {
      const moved = upsertKeyframe(t2, { ...kf, frame: target });
      const removed = removeKeyframe(moved, selectedFrame!);
      return removed;
    });
    selectedFrame = target;
    renderAll();
  });

  kfEasing.addEventListener("change", () => {
    if (!tech || selectedFrame === null) return;
    commit((t2) =>
      upsertKeyframe(t2, {
        ...t2.keyframes.find((k) => k.frame === selectedFrame)!,
        easing: kfEasing.value as Easing,
      }),
    );
  });

  btnKfDelete.addEventListener("click", () => {
    if (!tech || selectedFrame === null) return;
    commit((t2) => removeKeyframe(t2, selectedFrame!));
    selectedFrame = null;
    renderAll();
  });

  btnAddKf.addEventListener("click", () => {
    if (!tech) return;
    const target = Number(addFrameInput.value);
    if (!Number.isInteger(target) || target < 0) {
      setStatus(t("editor.frameInvalid"));
      return;
    }
    commit((t2) => {
      let src: Pose | undefined;
      const sel = t2.keyframes.find((k) => k.frame === selectedFrame);
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
      const pose = src ?? defaultHandPose(handTypeSelect.value as HandType);
      return upsertKeyframe(t2, { frame: target, pose });
    });
    selectedFrame = target;
    renderAll();
  });

  btnPlay.addEventListener("click", () => {
    if (!tech) return;
    playing = !playing;
    btnPlay.textContent = t(playing ? "editor.pause" : "editor.play");
  });

  pvSlider.addEventListener("input", () => {
    previewFrame = Number(pvSlider.value);
    renderPreview();
  });

  btnSave.addEventListener("click", () => {
    if (!tech) return;
    try {
      lib = upsertTechniqueInLib(lib, tech);
      saveLibrary(lib);
      setStatus(t("editor.saved"));
    } catch (e) {
      setStatus(t("editor.saveFail", { error: e instanceof Error ? e.message : String(e) }));
    }
  });

  // 播放：60fps 推进；离开页面自动停止
  const timer = window.setInterval(() => {
    if (!root.contains(page)) {
      window.clearInterval(timer);
      return;
    }
    if (!playing || !tech) return;
    const total = totalFrames();
    if (previewFrame >= total) previewFrame = 0;
    else previewFrame++;
    renderPreview();
  }, 1000 / 60);

  renderPicker();
  renderAll();
}

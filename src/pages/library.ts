import {
  deserializeFormulasOnly,
  deserializeLibraryData,
  loadLibrary,
  mergeLibrary,
  removeFormulaFromLib,
  removeTechniqueFromLib,
  saveLibrary,
  serializeLibraryData,
  upsertFormulaInLib,
  type LibraryData,
} from "../data/libraryStore";
import { createFormula, FormulaError } from "../data/formula";
import { SAMPLE_LIBRARY } from "../data/samples";
import { t } from "../i18n";
import "../styles/library.css";
import "../styles/pages.css";
import { el } from "../ui/dom";
import { navBar } from "../ui/nav";

export function renderLibraryPage(root: HTMLElement): void {
  root.innerHTML = "";
  let lib: LibraryData = loadLibrary();
  let editingId: string | null = null;

  const page = el("div", "", "page");
  page.prepend(navBar("library"));

  const title = el("h1", t("library.title"));
  const status = el("span", "", "save-status");
  status.id = "lib-status";

  const form = el("div", "", "lib-form");
  const fName = el("input") as HTMLInputElement;
  fName.id = "f-name";
  fName.placeholder = t("library.name");
  const fMoves = el("input") as HTMLInputElement;
  fMoves.id = "f-moves";
  fMoves.placeholder = t("library.moves");
  fMoves.spellcheck = false;
  const fTags = el("input") as HTMLInputElement;
  fTags.id = "f-tags";
  fTags.placeholder = t("library.tags");
  const fSubmit = el("button", t("library.add"), "primary") as HTMLButtonElement;
  fSubmit.id = "f-submit";
  const fCancel = el("button", t("library.cancel")) as HTMLButtonElement;
  fCancel.id = "f-cancel";
  fCancel.hidden = true;
  form.append(fName, fMoves, fTags, fSubmit, fCancel);

  const formulaHeading = el("h2", t("library.formulas"));
  const formulaRows = el("div");
  formulaRows.id = "formula-rows";

  const techniqueHeading = el("h2", t("library.techniques"));
  const techniqueRows = el("div");
  techniqueRows.id = "technique-rows";

  const actions = el("div", "", "lib-actions");
  const btnSamples = el("button", t("library.loadSamples")) as HTMLButtonElement;
  btnSamples.id = "btn-samples";
  const btnImport = el("button", t("library.import")) as HTMLButtonElement;
  btnImport.id = "btn-import";
  const fileInput = el("input") as HTMLInputElement;
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.hidden = true;
  const btnExport = el("button", t("library.export")) as HTMLButtonElement;
  btnExport.id = "btn-export";
  actions.append(btnSamples, btnImport, fileInput, btnExport);

  page.append(title, status, form, formulaHeading, formulaRows, actions, techniqueHeading, techniqueRows);
  root.appendChild(page);

  function setStatus(text: string) {
    status.textContent = text;
  }

  function persist() {
    saveLibrary(lib);
    renderRows();
  }

  function renderRows() {
    formulaRows.replaceChildren();
    if (lib.formulas.length === 0) {
      formulaRows.appendChild(el("p", t("library.empty"), "empty-note"));
    }
    for (const f of lib.formulas) {
      const row = el("div", "", "lib-row");
      row.dataset.name = f.name;
      const name = el("span", f.name);
      name.className = "lib-name";
      const moves = el("span", f.moves, "moves");
      const tags = el("span", f.tags.length ? f.tags.join(", ") : "", "tags");
      const btnEdit = el("button", t("library.edit"), "edit") as HTMLButtonElement;
      btnEdit.addEventListener("click", () => startEdit(f.id));
      const btnDel = el("button", t("library.delete"), "del") as HTMLButtonElement;
      btnDel.addEventListener("click", () => {
        lib = removeFormulaFromLib(lib, f.id);
        persist();
      });
      row.append(name, moves, tags, btnEdit, btnDel);
      formulaRows.appendChild(row);
    }

    techniqueRows.replaceChildren();
    if (lib.techniques.length === 0) {
      techniqueRows.appendChild(el("p", t("library.techniqueEmpty"), "empty-note"));
    }
    const formulaName = (id?: string) => lib.formulas.find((f) => f.id === id)?.name ?? "-";
    for (const tec of lib.techniques) {
      const row = el("div", "", "lib-row");
      row.dataset.name = tec.name;
      const name = el("span", tec.name);
      const meta = el(
        "span",
        `${formulaName(tec.formulaId)} ｜ ${t("library.kfCount", { n: tec.keyframes.length })} ｜ ${t("library.steps", { n: tec.stepMapping.length })}`,
        "meta",
      );
      const btnDel = el("button", t("library.delete"), "del") as HTMLButtonElement;
      btnDel.addEventListener("click", () => {
        lib = removeTechniqueFromLib(lib, tec.id);
        persist();
      });
      row.append(name, meta, btnDel);
      techniqueRows.appendChild(row);
    }
  }

  function startEdit(id: string) {
    const f = lib.formulas.find((x) => x.id === id);
    if (!f) return;
    editingId = id;
    fName.value = f.name;
    fMoves.value = f.moves;
    fTags.value = f.tags.join(", ");
    fSubmit.textContent = t("library.update");
    fCancel.hidden = false;
  }

  function resetForm() {
    editingId = null;
    fName.value = "";
    fMoves.value = "";
    fTags.value = "";
    fSubmit.textContent = t("library.add");
    fCancel.hidden = true;
  }

  fSubmit.addEventListener("click", () => {
    try {
      const formula = createFormula({
        id: editingId ?? undefined,
        name: fName.value,
        moves: fMoves.value,
        tags: fTags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      lib = upsertFormulaInLib(lib, formula);
      persist();
      resetForm();
      setStatus(t("library.addOk"));
    } catch (e) {
      setStatus(t("library.addFail", { error: e instanceof FormulaError ? e.message : String(e) }));
    }
  });

  fCancel.addEventListener("click", resetForm);

  btnSamples.addEventListener("click", () => {
    lib = mergeLibrary(lib, SAMPLE_LIBRARY);
    persist();
    setStatus(t("library.importOk", { n: SAMPLE_LIBRARY.formulas.length, m: SAMPLE_LIBRARY.techniques.length }));
  });

  btnImport.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      lib = mergeLibrary(lib, deserializeLibraryData(text));
      setStatus(t("library.importOk", { n: lib.formulas.length, m: lib.techniques.length }));
    } catch {
      try {
        lib = mergeLibrary(lib, deserializeFormulasOnly(text));
        setStatus(t("library.importOk", { n: lib.formulas.length, m: lib.techniques.length }));
      } catch (e2) {
        setStatus(t("library.importFail", { error: e2 instanceof Error ? e2.message : String(e2) }));
      }
    }
    persist();
    fileInput.value = "";
  });

  btnExport.addEventListener("click", () => {
    const blob = new Blob([serializeLibraryData(lib)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = "motion-cube-library.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus(t("library.exportOk"));
  });

  renderRows();
}

import {
  CategoryError,
  categoryPath,
  categoryLabelPath,
  categoryDepth,
  createCategory,
  MAX_CATEGORY_DEPTH,
  sortCategories,
  type Category,
} from "../data/category";
import { createFormula, FormulaError } from "../data/formula";
import {
  deserializeFormulasOnly,
  deserializeLibraryData,
  loadLibrary,
  mergeLibrary,
  removeCategoryFromLib,
  removeFormulaFromLib,
  removeTechniqueFromLib,
  saveLibrary,
  serializeLibraryData,
  upsertFormulaInLib,
  type LibraryData,
} from "../data/libraryStore";
import { SAMPLE_LIBRARY } from "../data/samples";
import { t } from "../i18n";
import "../styles/library.css";
import "../styles/pages.css";
import { el } from "../ui/dom";
import { navBar } from "../ui/nav";

const TAG_SUGGESTIONS = ["CFOP", "Roux", "ZZ", "单手", "脚拧"];

export function renderLibraryPage(root: HTMLElement): void {
  root.innerHTML = "";
  let lib: LibraryData = loadLibrary();
  let editingId: string | null = null;
  let cascadeChain: string[] = [];
  let selectedCatId: string | null = null;

  const page = el("div", "", "page");
  page.prepend(navBar("library"));

  const title = el("h1", t("library.title"));
  const status = el("span", "", "save-status");
  status.id = "lib-status";

  // ---- 公式表单（第一行：名称 + 标签；第二行：公式 + 分类 + 确认/取消）----
  const form = el("div", "", "lib-form");
  const formRow1 = el("div", "", "lib-form-row");
  const formRow2 = el("div", "", "lib-form-row");

  const fName = el("input") as HTMLInputElement;
  fName.id = "f-name";
  fName.placeholder = t("library.name");

  // 标签：chips + 输入 + "+"（最多 4 个）
  const tagChips = el("span", "", "tag-chips");
  tagChips.id = "tag-chips";
  const fTags = el("input") as HTMLInputElement;
  fTags.id = "f-tags";
  fTags.placeholder = t("library.tags");
  fTags.setAttribute("list", "tag-suggestions");
  const tagSuggest = el("datalist") as HTMLDataListElement;
  tagSuggest.id = "tag-suggestions";
  for (const s of TAG_SUGGESTIONS) {
    const opt = el("option");
    opt.value = s;
    tagSuggest.appendChild(opt);
  }
  const tagAdd = el("button", "+", "tag-add") as HTMLButtonElement;
  tagAdd.id = "tag-add";
  tagAdd.title = t("library.tagAddTitle");
  const tagCount = el("span", "", "tag-count");
  tagCount.id = "tag-count";

  const fMoves = el("input") as HTMLInputElement;
  fMoves.id = "f-moves";
  fMoves.placeholder = t("library.moves");
  fMoves.spellcheck = false;

  const catCascade = el("div", "", "cat-cascade");
  catCascade.id = "cat-cascade";
  const catPathLabel = el("span", "", "cat-path-label");

  const fSubmit = el("button", t("library.add"), "primary") as HTMLButtonElement;
  fSubmit.id = "f-submit";
  const fCancel = el("button", t("library.cancel")) as HTMLButtonElement;
  fCancel.id = "f-cancel";
  fCancel.hidden = true;

  formRow1.append(fName, tagChips, fTags, tagSuggest, tagAdd, tagCount);
  formRow2.append(fMoves, catCascade, catPathLabel, fSubmit, fCancel);
  form.append(formRow1, formRow2);

  const tagHint = el("p", t("library.tagHint"), "page-note");

  // ---- 分类管理 ----
  const catHeading = el("h2", t("library.categories"));
  const catForm = el("div", "", "cat-form");
  const catName = el("input") as HTMLInputElement;
  catName.id = "cat-name";
  catName.placeholder = t("library.categoryName");
  const catParent = el("select") as HTMLSelectElement;
  catParent.id = "cat-parent";
  const catAdd = el("button", t("library.categoryAdd")) as HTMLButtonElement;
  catAdd.id = "cat-add";
  catForm.append(catName, catParent, catAdd);
  const catRows = el("div");
  catRows.id = "category-rows";
  const catNote = el("p", t("library.categoryDepthNote"), "page-note");

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

  page.append(
    title,
    status,
    catHeading,
    catForm,
    catRows,
    catNote,
    formulaHeading,
    form,
    tagHint,
    formulaRows,
    actions,
    techniqueHeading,
    techniqueRows,
  );
  root.appendChild(page);

  function setStatus(text: string) {
    status.textContent = text;
  }

  function persist() {
    saveLibrary(lib);
    renderAll();
  }

  let tagList: string[] = [];
  const MAX_TAGS = 4;

  function renderTagChips() {
    tagChips.replaceChildren();
    for (const tag of tagList) {
      const chip = el("span", tag, "tag-chip");
      const x = el("button", "×", "tag-x") as HTMLButtonElement;
      x.addEventListener("click", () => {
        tagList = tagList.filter((t) => t !== tag);
        renderTagChips();
      });
      chip.appendChild(x);
      tagChips.appendChild(chip);
    }
    tagCount.textContent = `${tagList.length}/${MAX_TAGS}`;
  }

  function addTagsFromInput() {
    const parts = fTags.value
      .split(/[,，;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    fTags.value = "";
    let added = 0;
    for (const p of parts) {
      if (tagList.includes(p)) continue;
      if (tagList.length >= MAX_TAGS) {
        setStatus(t("library.tagLimit"));
        break;
      }
      tagList.push(p);
      added++;
    }
    if (added > 0) renderTagChips();
  }

  function sorted(): Category[] {
    return sortCategories(lib.categories);
  }

  function renderAll() {
    renderCategoryRows();
    renderCategoryParentOptions();
    renderCategoryCascade();
    renderFormulaRows();
    renderTechniqueRows();
  }

  function renderCategoryRows() {
    catRows.replaceChildren();
    const cats = sorted();
    for (const c of cats) {
      const depth = categoryDepth(c, cats);
      const row = el("div", "", "cat-row");
      row.dataset.id = c.id;
      row.dataset.name = c.name;
      row.style.marginLeft = `${Math.min(depth, 8) * 16}px`;
      const name = el("span", c.name, "cat-name");
      const path = el("span", categoryLabelPath(c, cats), "cat-path");
      const btnDel = el("button", t("library.categoryDelete"), "cat-del") as HTMLButtonElement;
      btnDel.addEventListener("click", () => {
        lib = removeCategoryFromLib(lib, c.id);
        persist();
      });
      row.append(name, path, btnDel);
      catRows.appendChild(row);
    }
  }

  function renderCategoryParentOptions() {
    catParent.replaceChildren();
    const noneOpt = el("option", t("library.categoryNone"));
    noneOpt.value = "";
    catParent.appendChild(noneOpt);
    const cats = sorted();
    for (const c of cats) {
      const opt = el("option", `${"　".repeat(categoryDepth(c, cats))}${c.name}`);
      opt.value = c.id;
      catParent.appendChild(opt);
    }
  }

  /** 级联胶囊下拉：按分类树逐层展开，最深选中项为公式分类 */
  function renderCategoryCascade() {
    catCascade.replaceChildren();
    catPathLabel.textContent = "";
    let parentId: string | null = null;
    let level = 0;
    for (;;) {
      const options = lib.categories
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
      if (options.length === 0 || level >= MAX_CATEGORY_DEPTH) break;
      const select = el("select", "", "cat-cascade-select") as HTMLSelectElement;
      const none = el("option", level === 0 ? t("library.categoryNone") : t("library.categoryEnd"));
      none.value = "";
      select.appendChild(none);
      for (const c of options) {
        const o = el("option", c.name);
        o.value = c.id;
        select.appendChild(o);
      }
      const cur = cascadeChain[level] ?? "";
      select.value = cur;
      // 闭包捕获当层的 level（level 是循环变量，直接引用会拿到循环结束后的值）
      const lv = level;
      select.addEventListener("change", () => {
        const v = select.value;
        cascadeChain = cascadeChain.slice(0, lv);
        if (v !== "") cascadeChain.push(v);
        renderCategoryCascade();
      });
      catCascade.appendChild(select);
      if (cur === "") break;
      parentId = cur;
      level++;
    }
    selectedCatId = cascadeChain.length > 0 ? cascadeChain[cascadeChain.length - 1] : null;
    if (selectedCatId) {
      const cats = sorted();
      const cat = cats.find((c) => c.id === selectedCatId);
      if (cat) catPathLabel.textContent = `${t("library.categoriesOf")}: ${categoryLabelPath(cat, cats)}`;
    }
  }

  function renderFormulaRows() {
    formulaRows.replaceChildren();
    if (lib.formulas.length === 0) {
      formulaRows.appendChild(el("p", t("library.empty"), "empty-note"));
    }
    const cats = sorted();
    const catNameOf = (id: string) => cats.find((c) => c.id === id)?.name ?? id;
    const techniqueCountOf = (id: string) => lib.techniques.filter((t) => t.formulaId === id).length;
    for (const f of lib.formulas) {
      const row = el("div", "", "lib-row");
      row.dataset.name = f.name;
      const name = el("span", f.name);
      name.className = "lib-name";
      const moves = el("span", f.moves, "moves");
      const catsText = f.categoryId
        ? `${t("library.categoriesOf")}: ${catNameOf(f.categoryId)}`
        : "";
      const catsSpan = el("span", catsText, "tags");
      const tags = el("span", f.tags.length ? f.tags.join(", ") : "", "tags");
      const techCount = techniqueCountOf(f.id);
      const techSpan = el("span", techCount ? t("library.techniqueCount", { n: techCount }) : "", "meta");
      const btnEdit = el("button", t("library.edit"), "edit") as HTMLButtonElement;
      btnEdit.addEventListener("click", () => startEdit(f.id));
      const btnDel = el("button", t("library.delete"), "del") as HTMLButtonElement;
      btnDel.addEventListener("click", () => {
        lib = removeFormulaFromLib(lib, f.id);
        persist();
      });
      row.append(name, moves, catsSpan, tags, techSpan, btnEdit, btnDel);
      formulaRows.appendChild(row);
    }
  }

  function renderTechniqueRows() {
    techniqueRows.replaceChildren();
    if (lib.techniques.length === 0) {
      techniqueRows.appendChild(el("p", t("library.techniqueEmpty"), "empty-note"));
    }
    const formulaName = (id?: string) => lib.formulas.find((f) => f.id === id)?.name ?? "-";
    const note = el("p", t("library.techniqueNote"), "page-note");
    techniqueRows.appendChild(note);
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
    tagList = [...f.tags];
    fTags.value = "";
    fSubmit.textContent = t("library.update");
    fCancel.hidden = false;
    renderTagChips();
    cascadeChain = f.categoryId ? categoryPath(f.categoryId, lib.categories) : [];
    renderCategoryCascade();
  }

  function resetForm() {
    editingId = null;
    fName.value = "";
    fMoves.value = "";
    fTags.value = "";
    tagList = [];
    renderTagChips();
    fSubmit.textContent = t("library.add");
    fCancel.hidden = true;
    cascadeChain = [];
    renderCategoryCascade();
  }

  fSubmit.addEventListener("click", () => {
    try {
      addTagsFromInput();
      const formula = createFormula({
        id: editingId ?? undefined,
        name: fName.value,
        moves: fMoves.value,
        tags: tagList,
        categoryId: selectedCatId,
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

  tagAdd.addEventListener("click", addTagsFromInput);
  fTags.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTagsFromInput();
    }
  });

  catAdd.addEventListener("click", () => {
    try {
      const parentId = catParent.value || null;
      const cat = createCategory({ name: catName.value, parentId }, lib.categories);
      lib = { ...lib, categories: [...lib.categories, cat] };
      catName.value = "";
      persist();
      setStatus(t("library.addOk"));
    } catch (e) {
      setStatus(t("library.categoryFail", { error: e instanceof CategoryError ? e.message : String(e) }));
    }
  });

  btnSamples.addEventListener("click", () => {
    lib = mergeLibrary(lib, SAMPLE_LIBRARY);
    persist();
    setStatus(
      t("library.importOk", { n: SAMPLE_LIBRARY.formulas.length, m: SAMPLE_LIBRARY.techniques.length }),
    );
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

  renderAll();
  renderTagChips();
}

<script setup lang="ts">
/**
 * 公式库/手法库页（Vue 迁移版）。
 * 保留 playtest 依赖的结构：所有输入/选择控件为原生元素（page.type/page.select），
 * 按钮为 WinButton（id/class 透传），列表行结构与 data-* 属性不变。
 */
import { computed, ref, watch } from "vue";
import WinButton from "../../vendor/winui-on-web/components/WinButton.vue";
import WinTextBlock from "../../vendor/winui-on-web/components/WinTextBlock.vue";
import {
  CategoryError,
  categoryDepth,
  categoryLabelPath,
  categoryPath,
  createCategory,
  MAX_CATEGORY_DEPTH,
  sortCategories,
  type Category,
} from "../../data/category";
import { createFormula, FormulaError } from "../../data/formula";
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
} from "../../data/libraryStore";
import { SAMPLE_LIBRARY } from "../../data/samples";
import { useI18n } from "../i18n";

const { t } = useI18n();

const TAG_SUGGESTIONS = ["CFOP", "Roux", "ZZ", "单手", "脚拧"];
const MAX_TAGS = 4;

const lib = ref<LibraryData>(loadLibrary());
const statusText = ref("");
const editingId = ref<string | null>(null);
const fName = ref("");
const fTags = ref("");
const fMoves = ref("");
const tagList = ref<string[]>([]);
const fSearch = ref("");
const pageSize = ref(10);
const page = ref(1);
const cascadeChain = ref<string[]>([]);
const catName = ref("");
const catParent = ref("");

const sorted = computed(() => sortCategories(lib.value.categories));

const selectedCatId = computed(() =>
  cascadeChain.value.length ? cascadeChain.value[cascadeChain.value.length - 1] : null,
);

const catPathLabelText = computed(() => {
  if (!selectedCatId.value) return "";
  const cat = sorted.value.find((c) => c.id === selectedCatId.value);
  return cat ? `${t("library.categoriesOf")}: ${categoryLabelPath(cat, sorted.value)}` : "";
});

/** 级联胶囊下拉：按分类树逐层展开，最深选中项为公式分类 */
const cascadeLevels = computed(() => {
  const levels: { options: Category[] }[] = [];
  let parentId: string | null = null;
  for (let level = 0; level < MAX_CATEGORY_DEPTH; level++) {
    const options = lib.value.categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    if (options.length === 0) break;
    levels.push({ options });
    const cur = cascadeChain.value[level];
    if (!cur) break;
    parentId = cur;
  }
  return levels;
});

const setStatus = (s: string): void => {
  statusText.value = s;
};

const persist = (): void => {
  saveLibrary(lib.value);
};

const addTagsFromInput = (): void => {
  const parts = fTags.value
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
  fTags.value = "";
  for (const p of parts) {
    if (tagList.value.includes(p)) continue;
    if (tagList.value.length >= MAX_TAGS) {
      setStatus(t("library.tagLimit"));
      break;
    }
    tagList.value.push(p);
  }
};

const removeTag = (tag: string): void => {
  tagList.value = tagList.value.filter((x) => x !== tag);
};

const onCascadeChange = (level: number, value: string): void => {
  cascadeChain.value = cascadeChain.value.slice(0, level);
  if (value !== "") cascadeChain.value.push(value);
};

const resetForm = (): void => {
  editingId.value = null;
  fName.value = "";
  fMoves.value = "";
  fTags.value = "";
  tagList.value = [];
  cascadeChain.value = [];
};

const submitFormula = (): void => {
  try {
    addTagsFromInput();
    const formula = createFormula({
      id: editingId.value ?? undefined,
      name: fName.value,
      moves: fMoves.value,
      tags: tagList.value,
      categoryId: selectedCatId.value,
    });
    lib.value = upsertFormulaInLib(lib.value, formula);
    persist();
    resetForm();
    setStatus(t("library.addOk"));
  } catch (e) {
    setStatus(t("library.addFail", { error: e instanceof FormulaError ? e.message : String(e) }));
  }
};

const startEdit = (id: string): void => {
  const f = lib.value.formulas.find((x) => x.id === id);
  if (!f) return;
  editingId.value = id;
  fName.value = f.name;
  fMoves.value = f.moves;
  fTags.value = "";
  tagList.value = [...f.tags];
  cascadeChain.value = f.categoryId ? categoryPath(f.categoryId, lib.value.categories) : [];
};

const removeFormula = (id: string): void => {
  lib.value = removeFormulaFromLib(lib.value, id);
  persist();
};

const removeTechnique = (id: string): void => {
  lib.value = removeTechniqueFromLib(lib.value, id);
  persist();
};

const removeCategory = (id: string): void => {
  lib.value = removeCategoryFromLib(lib.value, id);
  persist();
};

const addCategory = (): void => {
  try {
    const parentId = catParent.value || null;
    const cat = createCategory({ name: catName.value, parentId }, lib.value.categories);
    lib.value = { ...lib.value, categories: [...lib.value.categories, cat] };
    catName.value = "";
    persist();
    setStatus(t("library.addOk"));
  } catch (e) {
    setStatus(t("library.categoryFail", { error: e instanceof CategoryError ? e.message : String(e) }));
  }
};

const loadSamples = (): void => {
  lib.value = mergeLibrary(lib.value, SAMPLE_LIBRARY);
  persist();
  setStatus(t("library.importOk", { n: SAMPLE_LIBRARY.formulas.length, m: SAMPLE_LIBRARY.techniques.length }));
};

const onFileChange = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    lib.value = mergeLibrary(lib.value, deserializeLibraryData(text));
    setStatus(t("library.importOk", { n: lib.value.formulas.length, m: lib.value.techniques.length }));
  } catch {
    try {
      lib.value = mergeLibrary(lib.value, deserializeFormulasOnly(text));
      setStatus(t("library.importOk", { n: lib.value.formulas.length, m: lib.value.techniques.length }));
    } catch (e2) {
      setStatus(t("library.importFail", { error: e2 instanceof Error ? e2.message : String(e2) }));
    }
  }
  persist();
  input.value = "";
};

const exportJson = (): void => {
  const blob = new Blob([serializeLibraryData(lib.value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "motion-cube-library.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus(t("library.exportOk"));
};

const categoryRows = computed(() =>
  sorted.value.map((c) => ({ c, depth: categoryDepth(c, sorted.value) })),
);

const catParentOptions = computed(() => [
  { id: "", name: t("library.categoryNone"), depth: 0 },
  ...sorted.value.map((c) => ({ id: c.id, name: c.name, depth: categoryDepth(c, sorted.value) })),
]);

const formulaRows = computed(() => {
  const catNameOf = (id: string) => sorted.value.find((c) => c.id === id)?.name ?? id;
  const techniqueCountOf = (id: string) => lib.value.techniques.filter((x) => x.formulaId === id).length;
  return lib.value.formulas.map((f) => ({
    f,
    catText: f.categoryId ? `${t("library.categoriesOf")}: ${catNameOf(f.categoryId)}` : "",
    tagsText: f.tags.length ? f.tags.join(", ") : "",
    techCount: techniqueCountOf(f.id),
  }));
});

/** 搜索过滤：名称或公式串包含（大小写不敏感）；模糊/标签/分类搜索留待优化 */
const filteredFormulas = computed(() => {
  const q = fSearch.value.trim().toLowerCase();
  if (!q) return formulaRows.value;
  return formulaRows.value.filter(
    (r) => r.f.name.toLowerCase().includes(q) || r.f.moves.toLowerCase().includes(q),
  );
});

const totalPages = computed(() => Math.max(1, Math.ceil(filteredFormulas.value.length / pageSize.value)));
const pagedFormulas = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredFormulas.value.slice(start, start + pageSize.value);
});

watch([fSearch, pageSize], () => {
  page.value = 1;
});

const techniqueRows = computed(() => {
  const formulaName = (id?: string) => lib.value.formulas.find((f) => f.id === id)?.name ?? "-";
  return lib.value.techniques.map((tec) => ({
    tec,
    meta: `${formulaName(tec.formulaId)} ｜ ${t("library.kfCount", { n: tec.keyframes.length })} ｜ ${t("library.steps", { n: tec.stepMapping.length })}`,
  }));
});
</script>

<template>
  <div class="library-page">
    <WinTextBlock class="page-title" :Text="t('library.title')" FontSize="28" FontWeight="SemiBold" />
    <div id="lib-status" class="save-status">{{ statusText }}</div>

    <!-- 分类管理 -->
    <WinTextBlock class="section-title" :Text="t('library.categories')" FontSize="20" FontWeight="SemiBold" />
    <div class="cat-form">
      <input id="cat-name" v-model="catName" class="native-input" :placeholder="t('library.categoryName')" />
      <select id="cat-parent" v-model="catParent" class="native-select">
        <option v-for="opt in catParentOptions" :key="opt.id" :value="opt.id">
          {{ "　".repeat(opt.depth) }}{{ opt.name }}
        </option>
      </select>
      <WinButton id="cat-add" :Content="t('library.categoryAdd')" @Click="addCategory" />
    </div>
    <div id="category-rows" class="cat-rows">
      <div
        v-for="{ c, depth } in categoryRows"
        :key="c.id"
        class="cat-row"
        :data-id="c.id"
        :data-name="c.name"
        :style="{ marginLeft: `${Math.min(depth, 8) * 16}px` }">
        <span class="cat-name">{{ c.name }}</span>
        <span class="cat-path">{{ categoryLabelPath(c, sorted) }}</span>
        <WinButton class="cat-del" :Content="t('library.categoryDelete')" @Click="removeCategory(c.id)" />
      </div>
    </div>
    <WinTextBlock class="page-note" :Text="t('library.categoryDepthNote')" />

    <!-- 公式表单 -->
    <WinTextBlock class="section-title" :Text="t('library.formulas')" FontSize="20" FontWeight="SemiBold" />
    <div class="lib-form">
      <div class="lib-form-row">
        <input id="f-name" v-model="fName" class="native-input" :placeholder="t('library.name')" />
        <span id="tag-chips" class="tag-chips">
          <span v-for="tag in tagList" :key="tag" class="tag-chip">
            {{ tag }}
            <button class="tag-x" @click="removeTag(tag)">×</button>
          </span>
        </span>
        <input
          id="f-tags"
          v-model="fTags"
          class="native-input"
          list="tag-suggestions"
          :placeholder="t('library.tags')"
          @keydown.enter.prevent="addTagsFromInput" />
        <datalist id="tag-suggestions">
          <option v-for="s in TAG_SUGGESTIONS" :key="s" :value="s" />
        </datalist>
        <WinButton id="tag-add" Content="+" :title="t('library.tagAddTitle')" @Click="addTagsFromInput" />
        <span id="tag-count" class="tag-count">{{ tagList.length }}/{{ MAX_TAGS }}</span>
      </div>
      <div class="lib-form-row">
        <input id="f-moves" v-model="fMoves" class="native-input moves-input" spellcheck="false" :placeholder="t('library.moves')" />
        <div id="cat-cascade" class="cat-cascade">
          <select
            v-for="(lv, i) in cascadeLevels"
            :key="i"
            class="cat-cascade-select native-select"
            :value="cascadeChain[i] ?? ''"
            @change="onCascadeChange(i, ($event.target as HTMLSelectElement).value)">
            <option value="">{{ i === 0 ? t('library.categoryNone') : t('library.categoryEnd') }}</option>
            <option v-for="c in lv.options" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <span class="cat-path-label">{{ catPathLabelText }}</span>
        <WinButton
          id="f-submit"
          :Content="editingId ? t('library.update') : t('library.add')"
          Style="AccentButtonStyle"
          @Click="submitFormula" />
        <WinButton v-if="editingId" id="f-cancel" :Content="t('library.cancel')" @Click="resetForm" />
      </div>
    </div>
    <WinTextBlock class="page-note" :Text="t('library.tagHint')" />

    <div class="lib-toolbar">
      <input
        id="f-search"
        v-model="fSearch"
        class="native-input search-input"
        :placeholder="t('library.search')" />
      <select id="f-page-size" v-model.number="pageSize" class="native-select">
        <option :value="5">5</option>
        <option :value="10">10</option>
        <option :value="20">20</option>
        <option :value="50">50</option>
      </select>
      <span class="meta">{{ t("library.pageInfo", { n: pagedFormulas.length, total: filteredFormulas.length }) }}</span>
    </div>
    <div id="formula-rows" class="list-rows">
      <p v-if="filteredFormulas.length === 0" class="empty-note">{{ t("library.empty") }}</p>
      <div v-for="{ f, catText, tagsText, techCount } in pagedFormulas" :key="f.id" class="lib-row" :data-name="f.name">
        <span class="lib-name">{{ f.name }}</span>
        <span class="moves">{{ f.moves }}</span>
        <span class="tags">{{ catText }}</span>
        <span class="tags">{{ tagsText }}</span>
        <span class="meta">{{ techCount ? t("library.techniqueCount", { n: techCount }) : "" }}</span>
        <WinButton class="edit" :Content="t('library.edit')" @Click="startEdit(f.id)" />
        <WinButton class="del" :Content="t('library.delete')" @Click="removeFormula(f.id)" />
      </div>
    </div>
    <div v-if="totalPages > 1" class="pager">
      <WinButton :Content="t('library.prev')" :IsEnabled="page > 1" @Click="page--" />
      <span class="meta">{{ page }} / {{ totalPages }}</span>
      <WinButton :Content="t('library.next')" :IsEnabled="page < totalPages" @Click="page++" />
    </div>

    <div class="lib-actions">
      <WinButton id="btn-samples" :Content="t('library.loadSamples')" @Click="loadSamples" />
      <WinButton id="btn-import" :Content="t('library.import')" @Click="($refs.fileInput as HTMLInputElement | undefined)?.click()" />
      <input ref="fileInput" type="file" accept="application/json,.json" class="hidden-file" @change="onFileChange" />
      <WinButton id="btn-export" :Content="t('library.export')" @Click="exportJson" />
    </div>

    <WinTextBlock class="section-title" :Text="t('library.techniques')" FontSize="20" FontWeight="SemiBold" />
    <div id="technique-rows" class="list-rows">
      <p class="page-note">{{ t("library.techniqueNote") }}</p>
      <p v-if="techniqueRows.length === 0" class="empty-note">{{ t("library.techniqueEmpty") }}</p>
      <div v-for="{ tec, meta } in techniqueRows" :key="tec.id" class="lib-row" :data-name="tec.name">
        <span class="lib-name">{{ tec.name }}</span>
        <span class="meta">{{ meta }}</span>
        <WinButton class="del" :Content="t('library.delete')" @Click="removeTechnique(tec.id)" />
      </div>
    </div>
  </div>
</template>

<style>
.library-page {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  padding: 24px 28px;
  color: var(--text-primary);
}

.section-title {
  margin-top: 22px;
  margin-bottom: 8px;
  display: block;
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

.cat-form,
.lib-form-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cat-rows {
  margin-top: 8px;
}

.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.cat-name {
  font-weight: 600;
}

.cat-path {
  color: var(--text-tertiary);
  font-size: 12px;
}

.lib-form {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.moves-input {
  min-width: 280px;
  font-family: ui-monospace, Consolas, monospace;
}

.tag-chips {
  display: inline-flex;
  gap: 4px;
  flex-wrap: wrap;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--ctrl-fill-secondary);
  color: var(--text-primary);
  font-size: 13px;
}

.tag-x {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 2px;
  font-size: 13px;
}

.tag-count {
  color: var(--text-tertiary);
  font-size: 12px;
}

.cat-path-label {
  color: var(--text-secondary);
  font-size: 13px;
}

.list-rows {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lib-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.search-input {
  flex: 1 1 220px;
  min-width: 180px;
}

.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.lib-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  border: 1px solid var(--stroke-divider);
  border-radius: var(--ControlCornerRadius, 4px);
  background: var(--ctrl-fill-default);
}

.lib-name {
  font-weight: 600;
  min-width: 120px;
}

.moves {
  font-family: ui-monospace, Consolas, monospace;
  color: var(--text-secondary);
  font-size: 13px;
}

.tags {
  color: var(--text-tertiary);
  font-size: 13px;
}

.meta {
  color: var(--text-tertiary);
  font-size: 13px;
}

.lib-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.hidden-file {
  display: none;
}

.empty-note {
  color: var(--text-tertiary);
  font-size: 13px;
}

.page-note {
  color: var(--text-tertiary);
  font-size: 13px;
  max-width: 720px;
  margin-top: 8px;
}
</style>

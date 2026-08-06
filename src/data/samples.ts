/** 示例数据（由 scripts/gen-samples.mjs 生成，读取时校验合法性）。 */
import formulasJson from "../../data/samples/formulas.json";
import techniquesJson from "../../data/samples/techniques.json";
import { deserializeFormula } from "./formula";
import type { FormulaLibrary } from "./formula";
import type { LibraryData } from "./libraryStore";
import { deserializeTechnique } from "./technique";
import type { Technique } from "./technique";

export const SAMPLE_FORMULAS: FormulaLibrary = deserializeFormula(JSON.stringify(formulasJson));
export const SAMPLE_TECHNIQUES: Technique[] = (techniquesJson as unknown[]).map((item) =>
  deserializeTechnique(JSON.stringify(item)),
);

export const SAMPLE_LIBRARY: LibraryData = {
  version: 1,
  formulas: SAMPLE_FORMULAS.formulas,
  techniques: SAMPLE_TECHNIQUES,
};

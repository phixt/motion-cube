/** 示例数据（由 scripts/gen-samples.ts 生成，读取时校验合法性）。 */
import libraryJson from "../../data/samples/library.json";
import type { FormulaLibrary } from "./formula";
import { deserializeLibraryData, type LibraryData } from "./libraryStore";
import type { Technique } from "./technique";

export const SAMPLE_LIBRARY: LibraryData = deserializeLibraryData(JSON.stringify(libraryJson));

export const SAMPLE_FORMULAS: FormulaLibrary = {
  version: 1,
  formulas: SAMPLE_LIBRARY.formulas,
};

export const SAMPLE_TECHNIQUES: Technique[] = SAMPLE_LIBRARY.techniques;

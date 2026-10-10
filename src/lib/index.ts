/**
 * Stable headless surface for the CLI and other Node callers.
 *
 * Everything else under `src/` is internal: import from here rather than reaching into content/,
 * wizard/, report/, imports/ or engine/ modules directly. The browser app is free to use those paths.
 */

export { loadCatalogueFromDisk, catalogueView, questionIdsOf, type LoadedCatalogue } from "./catalogue";
export {
  applyScan,
  readScan,
  resolveImporter,
  detectImporter,
  importerFor,
  importers,
  type ToolChoice,
  type ScanImporter,
  type ScanResult,
} from "./scan";
export { scoreSummary, scoreText } from "./score";
export {
  renderReportToFile,
  renderAiRegisterToFile,
  renderReportToBuffer,
  renderAiRegisterToBuffer,
} from "./render";

export { loadCatalogue, contentDigest, type ContentFiles } from "../content/loader";
export type { Catalogue } from "../content/schema";

export { parseAssessment, type ParseResult, type ParseNotice, type ParseOptions } from "../wizard/parseAssessment";
export { migrate, detectSchemaVersion, type MigrationResult } from "../wizard/migrations";
export { assessmentSchema, formatIssues, SCHEMA_VERSION, APP_VERSION } from "../wizard/assessmentSchema";
export { toSaveFile, SCHEMA_URL } from "../wizard/saveFile";
export { emptyAssessment, STEP_LAYOUT } from "../wizard/empty";
export { buildXlsx, type Sheet } from "../wizard/xlsx";

export { buildReport, buildAiRegisterReport, type ReportModel, type AiRegisterReportModel } from "../report/model";
export { fixtureAssessment } from "../report/fixture";
export { fontFilesOnDisk, registerFonts, registerFontsFromDisk, type FontFiles } from "../report/fonts";

export { registerTable, toCsv, aboutRows } from "../engine/aiExport";
export type { Assessment } from "../engine/types";

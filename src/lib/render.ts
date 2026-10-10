import { renderToBuffer, renderToFile } from "@react-pdf/renderer";
import { createElement } from "react";
import { AiRegisterDocument, ReportDocument } from "../report/Document";
import { registerFontsFromDisk } from "../report/fonts";
import type { AiRegisterReportModel, ReportModel } from "../report/model";

/** Render the full report PDF to a path. Registers on-disk fonts once; branding comes from the model only. */
export async function renderReportToFile(model: ReportModel, outPath: string): Promise<void> {
  registerFontsFromDisk();
  await renderToFile(createElement(ReportDocument, { model }) as Parameters<typeof renderToFile>[0], outPath);
}

/** Render the standalone AI register PDF to a path. */
export async function renderAiRegisterToFile(model: AiRegisterReportModel, outPath: string): Promise<void> {
  registerFontsFromDisk();
  await renderToFile(createElement(AiRegisterDocument, { model }) as Parameters<typeof renderToFile>[0], outPath);
}

/** Full report as a PDF buffer (tests). */
export async function renderReportToBuffer(model: ReportModel): Promise<Uint8Array> {
  registerFontsFromDisk();
  return renderToBuffer(createElement(ReportDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
}

/** Standalone AI register as a PDF buffer (tests). */
export async function renderAiRegisterToBuffer(model: AiRegisterReportModel): Promise<Uint8Array> {
  registerFontsFromDisk();
  return renderToBuffer(createElement(AiRegisterDocument, { model }) as Parameters<typeof renderToBuffer>[0]);
}

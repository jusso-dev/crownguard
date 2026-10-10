/**
 * PDF render in a module worker. Fonts load by URL here.
 * Receives assessment JSON (ReportModel has functions — not cloneable).
 */
import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { catalogue, ensurePlatforms, ensureReportContent } from "../content/catalogue";
import type { Assessment } from "../engine/types";
import { AiRegisterDocument, ReportDocument } from "./Document";
import { registerFonts } from "./fonts";
import { buildAiRegisterReport, buildReport } from "./model";
import regular from "./fonts/Inter_400Regular.ttf?url";
import italic from "./fonts/Inter_400Regular_Italic.ttf?url";
import semibold from "./fonts/Inter_600SemiBold.ttf?url";
import bold from "./fonts/Inter_700Bold.ttf?url";

registerFonts({ regular, italic, semibold, bold });

export type PdfWorkerRequest =
  | { id: number; kind: "report"; assessment: Assessment; generatedAt: string }
  | { id: number; kind: "ai-register"; assessment: Assessment; generatedAt: string };

export type PdfWorkerResponse =
  | { id: number; ok: true; blob: Blob }
  | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const msg = event.data;
  try {
    await Promise.all([ensurePlatforms(msg.assessment.platforms), ensureReportContent()]);
    const at = new Date(msg.generatedAt);
    const element =
      msg.kind === "ai-register"
        ? createElement(AiRegisterDocument, { model: buildAiRegisterReport(catalogue, msg.assessment, at) })
        : createElement(ReportDocument, { model: buildReport(catalogue, msg.assessment, at) });
    const blob = await pdf(element as Parameters<typeof pdf>[0]).toBlob();
    const response: PdfWorkerResponse = { id: msg.id, ok: true, blob };
    self.postMessage(response);
  } catch (e) {
    const response: PdfWorkerResponse = {
      id: msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(response);
  }
};

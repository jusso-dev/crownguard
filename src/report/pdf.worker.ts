/** Renders PDFs off the main thread. Takes the assessment, not the report model, which holds functions. */
import type { Assessment } from "../format/schema";
import { renderPdfBlob } from "./browserPdf";
import type { PdfKind } from "./render";

export interface PdfWorkerRequest {
  id: number;
  kind: PdfKind;
  assessment: Assessment;
  generatedAt: string;
}

export type PdfWorkerResponse = { id: number; ok: true; blob: Blob } | { id: number; ok: false; error: string };

self.onmessage = async (event: MessageEvent<PdfWorkerRequest>) => {
  const { id, kind, assessment, generatedAt } = event.data;
  let response: PdfWorkerResponse;
  try {
    response = { id, ok: true, blob: await renderPdfBlob(kind, assessment, new Date(generatedAt)) };
  } catch (e) {
    response = { id, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  self.postMessage(response);
};

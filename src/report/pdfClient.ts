import type { Assessment } from "../engine/types";
import type { PdfWorkerRequest, PdfWorkerResponse } from "./pdf.worker";

export type PdfRenderRequest =
  | { kind: "report"; assessment: Assessment; generatedAt?: Date }
  | { kind: "ai-register"; assessment: Assessment; generatedAt?: Date };

/** How the last successful (or attempted) render ran. Exposed for tests. */
export type PdfRenderPath = "worker" | "main-thread";

let lastPath: PdfRenderPath = "main-thread";
let workerFailedReason: string | undefined;
let worker: Worker | null | undefined;
let nextId = 1;

export function lastPdfRenderPath(): PdfRenderPath {
  return lastPath;
}

export function pdfWorkerFailureReason(): string | undefined {
  return workerFailedReason;
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("error", (event) => {
      workerFailedReason = event.message || "Worker error event";
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
    });
    return worker;
  } catch (e) {
    // Spike result: construction failed (CSP, unsupported, or yoga/WASM not usable in a module worker).
    workerFailedReason = e instanceof Error ? e.message : String(e);
    worker = null;
    return null;
  }
}

function renderInWorker(req: PdfRenderRequest): Promise<Blob> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error(workerFailedReason ?? "PDF worker unavailable"));

  const id = nextId++;
  const generatedAt = (req.generatedAt ?? new Date()).toISOString();
  const message: PdfWorkerRequest =
    req.kind === "ai-register"
      ? { id, kind: "ai-register", assessment: req.assessment, generatedAt }
      : { id, kind: "report", assessment: req.assessment, generatedAt };

  return new Promise<Blob>((resolve, reject) => {
    const onMessage = (event: MessageEvent<PdfWorkerResponse>) => {
      if (event.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      if (event.data.ok) resolve(event.data.blob);
      else reject(new Error(event.data.error));
    };
    const onError = (event: ErrorEvent) => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      workerFailedReason = event.message || "PDF worker crashed";
      try {
        w.terminate();
      } catch {
        /* ignore */
      }
      worker = null;
      reject(new Error(workerFailedReason));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage(message);
  });
}

async function renderOnMainThread(req: PdfRenderRequest): Promise<Blob> {
  const { renderPdf, renderAiRegisterPdf } = await import("./generate");
  const { buildAiRegisterReport, buildReport } = await import("./model");
  const { catalogue } = await import("../content/catalogue");
  const { ensurePlatforms, ensureReportContent } = await import("../content/catalogue");
  await Promise.all([ensurePlatforms(req.assessment.platforms), ensureReportContent()]);
  const at = req.generatedAt ?? new Date();
  return req.kind === "ai-register"
    ? renderAiRegisterPdf(buildAiRegisterReport(catalogue, req.assessment, at))
    : renderPdf(buildReport(catalogue, req.assessment, at));
}

/**
 * Prefer a module worker for PDF layout. Fall back to the main thread if Worker construction
 * fails or the first worker render errors (e.g. yoga WASM). Comment records the failure reason.
 */
function publishPath(path: PdfRenderPath) {
  lastPath = path;
  (globalThis as unknown as { __crownguardPdfPath?: PdfRenderPath }).__crownguardPdfPath = path;
}

export async function renderPdfInWorker(req: PdfRenderRequest): Promise<Blob> {
  try {
    const blob = await renderInWorker(req);
    publishPath("worker");
    return blob;
  } catch (e) {
    // Fallback: react-pdf/yoga did not run cleanly in a Vite module worker (or Worker was stubbed).
    if (!workerFailedReason) workerFailedReason = e instanceof Error ? e.message : String(e);
    publishPath("main-thread");
    return renderOnMainThread(req);
  }
}

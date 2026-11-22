import type { Assessment } from "../format/schema";
import type { PdfWorkerRequest, PdfWorkerResponse } from "./pdf.worker";
import type { PdfKind } from "./render";

type PdfRenderPath = "worker" | "main-thread";

let worker: Worker | null | undefined;
let nextId = 1;

/** The worker, or null once it has failed to start or crashed: after that every render runs on the main thread. */
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
  } catch {
    // Construction fails under a strict CSP, or where module workers aren't supported.
    worker = null;
  }
  return worker;
}

function renderInWorker(kind: PdfKind, assessment: Assessment, generatedAt: Date): Promise<Blob> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("PDF worker unavailable"));
  const message: PdfWorkerRequest = { id: nextId++, kind, assessment, generatedAt: generatedAt.toISOString() };
  return new Promise<Blob>((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent<PdfWorkerResponse>) => {
      if (event.data.id !== message.id) return;
      done();
      if (event.data.ok) resolve(event.data.blob);
      else reject(new Error(event.data.error));
    };
    const onError = (event: ErrorEvent) => {
      done();
      w.terminate();
      worker = null;
      reject(new Error(event.message || "PDF worker crashed"));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage(message);
  });
}

/** Where the last PDF rendered, for the e2e performance check. */
function publishPath(path: PdfRenderPath) {
  (globalThis as unknown as { __crownguardPdfPath?: PdfRenderPath }).__crownguardPdfPath = path;
}

/**
 * Render a PDF, in a module worker when possible so the page stays responsive. Falls back to the main thread when the
 * worker can't start or a worker render fails (react-pdf's layout engine doesn't run in every worker).
 */
export async function renderPdf(kind: PdfKind, assessment: Assessment, generatedAt = new Date()): Promise<Blob> {
  try {
    const blob = await renderInWorker(kind, assessment, generatedAt);
    publishPath("worker");
    return blob;
  } catch {
    publishPath("main-thread");
    const { renderPdfBlob } = await import("./browserPdf");
    return renderPdfBlob(kind, assessment, generatedAt);
  }
}

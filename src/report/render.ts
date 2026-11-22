import { createElement, type ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import type { Catalogue } from "../content/schema";
import type { Assessment } from "../format/schema";
import { AiRegisterDocument, ReportDocument } from "./Document";
import { buildAiRegisterReport, buildReport } from "./model";

/** The full crown-jewel report, or the standalone AI use-case register. */
export type PdfKind = "report" | "ai-register";

/** The PDF document for an assessment. Every renderer (worker, main thread, CLI, tests) starts here. */
export function documentFor(catalogue: Catalogue, kind: PdfKind, assessment: Assessment, generatedAt = new Date()): ReactElement<DocumentProps> {
  const element =
    kind === "ai-register"
      ? createElement(AiRegisterDocument, { model: buildAiRegisterReport(catalogue, assessment, generatedAt) })
      : createElement(ReportDocument, { model: buildReport(catalogue, assessment, generatedAt) });
  return element as unknown as ReactElement<DocumentProps>;
}

import { useState } from "react";
import { catalogue } from "../../content/catalogue";
import { buildReport } from "../../report/model";
import { formatAbn, isValidAbn } from "../../engine/abn";
import { download, requestOpenFile, slug } from "../download";
import { useStore } from "../store";
import { Button, Card, StepHeader } from "../ui";

export function ReportStep() {
  const assessment = useStore((s) => s.assessment);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [error, setError] = useState<string>();
  const model = buildReport(catalogue, assessment);

  async function generate() {
    setStatus("working");
    setError(undefined);
    try {
      // The PDF renderer is large, so load it only when needed.
      const { renderPdf } = await import("../../report/generate");
      const now = new Date();
      const blob = await renderPdf(buildReport(catalogue, assessment, now));
      const p2 = (n: number) => String(n).padStart(2, "0");
      const date = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}`;
      download(`${slug(assessment.org.name)}-crown-jewel-risk-${date}.pdf`, blob, "application/pdf");
      setStatus("done");
    } catch (e) {
      console.error(e);
      setError((e as Error).message);
      setStatus("error");
    }
  }

  return (
    <>
      <StepHeader title="Download your report">
        The PDF is built in your browser. It includes an executive summary, your crown-jewel register, a risk register,
        findings with recommended fixes, a 30/60/90-day roadmap, framework alignment and references.
      </StepHeader>
      <Card className="max-w-xl overflow-hidden p-0!">
        <div className="p-6">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-8 gap-y-2.5 text-sm [&_dd]:text-ink [&_dd]:tabular-nums">
          <dt className="text-muted">Organisation</dt><dd>{assessment.org.name}</dd>
          {assessment.org.abn && (
            <>
              <dt className="text-muted">ABN</dt>
              <dd className="font-mono">{isValidAbn(assessment.org.abn) ? formatAbn(assessment.org.abn) : "Invalid, not printed"}</dd>
            </>
          )}
          <dt className="text-muted">Logo</dt><dd>{assessment.branding.logoDataUrl ? "Added" : "None (add one on the Organisation or Branding step)"}</dd>
          <dt className="text-muted">Platforms</dt><dd>{model.platformNames.join(", ")}</dd>
          <dt className="text-muted">Crown jewels</dt><dd>{model.risks.length}</dd>
          <dt className="text-muted">Questions answered</dt><dd>{model.questions.filter((q) => model.answers[q.id]).length} of {model.questions.length}</dd>
          <dt className="text-muted">Roadmap actions</dt><dd>{model.roadmap.length}</dd>
          <dt className="text-muted">Marking</dt><dd>{assessment.branding.marking}</dd>
        </dl>
        </div>
        <div className="border-t border-rule bg-paper p-6">
        <Button className="w-full py-2.5" loading={status === "working"} onClick={() => void generate()}>
          {status === "working" ? "Building PDF…" : "Generate PDF report"}
        </Button>
        {status === "done" && <p className="mt-3 text-sm text-ok" role="status">Report downloaded. Check your downloads folder.</p>}
        <p className="mt-3 text-xs text-muted">Each report is stamped with the date and time it was generated, and the time the answers were last changed.</p>
        {status === "error" && <p className="mt-3 text-sm text-danger" role="alert">Couldn't build the PDF: {error}</p>}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Your progress is saved in this browser. Use <strong className="font-medium text-ink-2">Save file</strong> at the top to keep a copy, then <strong className="font-medium text-ink-2">Open file</strong> later to update the assessment and regenerate the report. Updating an older report?{" "}
          <button type="button" className="font-medium text-accent underline decoration-accent/30 underline-offset-2" onClick={requestOpenFile}>
            Open its saved file
          </button>
          , add the logo or ABN on the Organisation step, then generate again.
        </p>
        </div>
      </Card>
    </>
  );
}

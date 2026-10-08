import { useState } from "react";
import { catalogue } from "../../content/catalogue";
import { buildReport } from "../../report/model";
import { download, slug } from "../download";
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
      const blob = await renderPdf(buildReport(catalogue, assessment));
      const date = new Date().toISOString().slice(0, 10);
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
          <dt className="text-muted">Platforms</dt><dd>{model.platformNames.join(", ")}</dd>
          <dt className="text-muted">Crown jewels</dt><dd>{model.risks.length}</dd>
          <dt className="text-muted">Questions answered</dt><dd>{model.questions.filter((q) => assessment.answers[q.id]).length} of {model.questions.length}</dd>
          <dt className="text-muted">Roadmap actions</dt><dd>{model.roadmap.length}</dd>
          <dt className="text-muted">Marking</dt><dd>{assessment.branding.marking}</dd>
        </dl>
        </div>
        <div className="border-t border-rule bg-paper p-6">
        <Button className="w-full py-2.5" loading={status === "working"} onClick={() => void generate()}>
          {status === "working" ? "Building PDF…" : "Generate PDF report"}
        </Button>
        {status === "done" && <p className="mt-3 text-sm text-ok" role="status">Report downloaded. Check your downloads folder.</p>}
        {status === "error" && <p className="mt-3 text-sm text-danger" role="alert">Couldn't build the PDF: {error}</p>}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          Your progress is saved in this browser. Use <strong className="font-medium text-ink-2">Save file</strong> at the top to keep a copy, then <strong className="font-medium text-ink-2">Open file</strong> later to update the assessment and regenerate the report.
        </p>
        </div>
      </Card>
    </>
  );
}

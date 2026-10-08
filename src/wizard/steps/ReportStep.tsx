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
      <Card className="max-w-xl">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-ink-soft">Organisation</dt><dd>{assessment.org.name}</dd>
          <dt className="text-ink-soft">Platforms</dt><dd>{model.platformNames.join(", ")}</dd>
          <dt className="text-ink-soft">Crown jewels</dt><dd>{model.risks.length}</dd>
          <dt className="text-ink-soft">Questions answered</dt><dd>{model.questions.filter((q) => assessment.answers[q.id]).length} of {model.questions.length}</dd>
          <dt className="text-ink-soft">Roadmap actions</dt><dd>{model.roadmap.length}</dd>
          <dt className="text-ink-soft">Marking</dt><dd>{assessment.branding.marking}</dd>
        </dl>
        <Button className="mt-6 w-full py-3" disabled={status === "working"} onClick={() => void generate()}>
          {status === "working" ? "Building PDF…" : "Generate PDF report"}
        </Button>
        {status === "done" && <p className="mt-3 text-sm text-green-800" role="status">Report downloaded. Check your downloads folder.</p>}
        {status === "error" && <p className="mt-3 text-sm text-red-700" role="alert">Couldn't build the PDF: {error}</p>}
        <p className="mt-4 text-xs leading-relaxed text-ink-soft">
          Tip: use <strong>Export</strong> at the top of the page to save your answers as a file. You can import it later to update the assessment.
        </p>
      </Card>
    </>
  );
}

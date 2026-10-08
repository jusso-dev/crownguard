import { useEffect, useRef, useState } from "react";
import { catalogue } from "./content/catalogue";
import { activeQuestions } from "./engine/risk";
import type { Assessment } from "./engine/types";
import { assessmentSchema } from "./wizard/assessmentSchema";
import { clampStep, hasProgress, steps, storageAvailable, useStep, useStore } from "./wizard/store";
import { Button, Card } from "./wizard/ui";
import { OrgStep } from "./wizard/steps/OrgStep";
import { EnvironmentStep } from "./wizard/steps/EnvironmentStep";
import { JewelsStep } from "./wizard/steps/JewelsStep";
import { ControlsStep } from "./wizard/steps/ControlsStep";
import { ReviewStep } from "./wizard/steps/ReviewStep";
import { BrandingStep } from "./wizard/steps/BrandingStep";
import { ReportStep } from "./wizard/steps/ReportStep";
import { download, slug } from "./wizard/download";
import { relativeTime } from "./wizard/time";

const views = [OrgStep, EnvironmentStep, JewelsStep, ControlsStep, ReviewStep, BrandingStep, ReportStep];

/** A step can be entered once the steps before it have their minimum inputs. */
function useReachable(): number {
  const a = useStore((s) => s.assessment);
  if (!a.org.name.trim()) return 0;
  if (!a.platforms.length) return 1;
  if (!a.jewels.length) return 2;
  return steps.length - 1;
}

const saveFileName = (a: Assessment) => `${slug(a.org.name)}.crownguard.json`;

/** Re-render periodically so relative times stay current. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function SaveStatus({ persisted }: { persisted: boolean }) {
  const updatedAt = useStore((s) => s.assessment.updatedAt);
  const now = useNow();
  if (!persisted)
    return (
      <span role="status" className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
        This browser won't keep your progress. Use <strong>Save file</strong> before you leave.
      </span>
    );
  return (
    <span role="status" className="text-xs text-ink-soft" title="Progress saves automatically in this browser as you go">
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-600 align-middle" />
      Saved in this browser · {relativeTime(updatedAt, now)}
    </span>
  );
}

function ResumeCard({ onContinue, onSave, onNew }: { onContinue: () => void; onSave: () => void; onNew: () => void }) {
  const a = useStore((s) => s.assessment);
  const now = useNow();
  const questions = activeQuestions(catalogue, a);
  const answered = questions.filter((q) => a.answers[q.id]).length;
  return (
    <Card className="mx-auto mt-6 max-w-xl p-7">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold">Welcome back</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{a.org.name || "Your assessment"}</h1>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-ink-soft">You were on</dt><dd>{steps[clampStep(a.progress?.step)]}</dd>
        <dt className="text-ink-soft">Crown jewels</dt><dd>{a.jewels.length}</dd>
        <dt className="text-ink-soft">Questions answered</dt><dd>{answered} of {questions.length}</dd>
        <dt className="text-ink-soft">Last saved</dt><dd>{relativeTime(a.updatedAt, now)}</dd>
      </dl>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={onContinue} autoFocus>Continue where you left off</Button>
        <Button variant="secondary" onClick={onSave}>Save file</Button>
        <Button variant="ghost" onClick={onNew}>Start a new assessment</Button>
      </div>
      <p className="mt-5 text-xs leading-relaxed text-ink-soft">
        Progress is kept in this browser only. To continue on another computer, or to keep a copy, use <strong>Save file</strong> and open it later.
      </p>
    </Card>
  );
}

export function App() {
  const { assessment, setStep, load, reset } = useStore();
  const step = useStep();
  const reachable = useReachable();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string }>();
  const [persisted] = useState(storageAvailable);
  const [resuming, setResuming] = useState(() => hasProgress(useStore.getState().assessment));
  const View = views[step] ?? OrgStep;

  const saveFile = () => download(saveFileName(assessment), JSON.stringify(assessment, null, 2), "application/json");

  async function onOpen(file: File) {
    setNotice(undefined);
    try {
      const parsed = assessmentSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "unrecognised format");
      load(parsed.data);
      setResuming(false);
      setNotice({ kind: "ok", text: `Opened ${parsed.data.org.name || "assessment"}. Picking up at ${steps[clampStep(parsed.data.progress?.step)]}.` });
    } catch (e) {
      setNotice({ kind: "error", text: `Couldn't open that file: ${(e as Error).message}` });
    }
  }

  function startNew() {
    if (!hasProgress(assessment) || confirm("Start a new assessment? The current one will be removed from this browser. Choose Cancel, then Save file, if you want to keep it.")) {
      reset();
      setResuming(false);
      setNotice(undefined);
    }
  }

  function onClear() {
    if (confirm("Delete this assessment from this browser? Use Save file first if you want to keep it.")) {
      reset();
      setNotice(undefined);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="mr-auto">
            <div className="font-semibold tracking-tight">crownguard</div>
            <SaveStatus persisted={persisted} />
          </div>
          <Button variant="secondary" onClick={saveFile} title="Download your progress as a file you can open later">
            Save file
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()} title="Continue from a saved file">
            Open file
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onOpen(f);
              e.target.value = "";
            }}
          />
          <Button variant="danger" onClick={onClear}>
            Clear data
          </Button>
        </div>
        {notice && (
          <div role={notice.kind === "error" ? "alert" : "status"} className={`px-6 py-2 text-sm ${notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-green-50 text-green-900"}`}>
            {notice.text}
          </div>
        )}
      </header>

      {resuming ? (
        <div className="px-4 py-8 sm:px-6">
          <ResumeCard onContinue={() => setResuming(false)} onSave={saveFile} onNew={startNew} />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[200px_1fr]">
          <nav aria-label="Steps" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
            <ol className="flex gap-1 overflow-x-auto lg:flex-col">
              {steps.map((label, i) => (
                <li key={label}>
                  <button
                    type="button"
                    disabled={i > reachable}
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => setStep(i)}
                    className={`flex w-full items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      i === step ? "bg-ink text-white" : "hover:bg-black/5"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${
                        i === step ? "bg-gold text-white" : "bg-line text-ink-soft"
                      }`}
                    >
                      {i + 1}
                    </span>
                    {label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <main className="min-w-0">
            <View />
            <div className="mt-10 flex justify-between border-t border-line pt-5">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
                ← Back
              </Button>
              {step < steps.length - 1 && (
                <Button disabled={step + 1 > reachable} onClick={() => { setStep(step + 1); window.scrollTo({ top: 0 }); }}>
                  Next: {steps[step + 1]} →
                </Button>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { catalogue } from "./content/catalogue";
import { activeQuestions, effectiveAnswers } from "./engine/risk";
import type { Assessment } from "./engine/types";
import { assessmentSchema } from "./wizard/assessmentSchema";
import { clampStep, hasProgress, steps, storageAvailable, useStep, useStore } from "./wizard/store";
import { Button } from "./wizard/ui";
import { OrgStep } from "./wizard/steps/OrgStep";
import { EnvironmentStep } from "./wizard/steps/EnvironmentStep";
import { JewelsStep } from "./wizard/steps/JewelsStep";
import { ControlsStep } from "./wizard/steps/ControlsStep";
import { ReviewStep } from "./wizard/steps/ReviewStep";
import { SocStep } from "./wizard/steps/SocStep";
import { AiRegisterStep } from "./wizard/steps/AiRegisterStep";
import { BrandingStep } from "./wizard/steps/BrandingStep";
import { ReportStep } from "./wizard/steps/ReportStep";
import { createFileSaver, OPEN_FILE_EVENT, slug } from "./wizard/download";
import { relativeTime } from "./wizard/time";

// One view per entry in `steps` (wizard/store.ts), in the same order.
const views = [OrgStep, EnvironmentStep, JewelsStep, ControlsStep, SocStep, AiRegisterStep, ReviewStep, BrandingStep, ReportStep];

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

function SaveStatus({ persisted, fileSave }: { persisted: boolean; fileSave?: { file: string; at: string; downloaded: boolean } }) {
  const updatedAt = useStore((s) => s.assessment.updatedAt);
  const now = useNow(fileSave ? 5_000 : 30_000);
  // A file save in the last minute takes over the status line; no toast, nothing moves.
  if (fileSave && now - Date.parse(fileSave.at) < 60_000)
    return (
      <span role="status" className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-ok">
        <span aria-hidden>✓</span>
        {fileSave.downloaded ? `Downloaded ${fileSave.file}` : `Saved to ${fileSave.file}`} · {relativeTime(fileSave.at, now)}
      </span>
    );
  if (!persisted)
    return (
      <span role="status" className="inline-flex items-center gap-1.5 rounded-[4px] bg-warn-soft px-2 py-0.5 text-xs text-warn">
        This browser won't keep your progress. Use <strong>Save file</strong> before you leave.
      </span>
    );
  return (
    <span role="status" className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-muted" title="Progress saves automatically in this browser as you go">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
      Saved in this browser · {relativeTime(updatedAt, now)}
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

function ResumeCard({ onContinue, onSave, onNew }: { onContinue: () => void; onSave: () => void; onNew: () => void }) {
  const a = useStore((s) => s.assessment);
  const now = useNow();
  const questions = activeQuestions(catalogue, a);
  const answers = effectiveAnswers(a);
  const answered = questions.filter((q) => answers[q.id]).length;
  const at = clampStep(a.progress?.step);
  return (
    <div className="mx-auto mt-4 max-w-xl overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface">
      <div className="p-7">
        <p className="mono-label text-accent">Welcome back</p>
        <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight">{a.org.name || "Your assessment"}</h1>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
          <dt className="text-muted">You were on</dt>
          <dd className="text-ink">
            <span className="mr-2 font-mono text-xs text-muted">{pad(at + 1)}</span>
            <span>{steps[at]}</span>
          </dd>
          <dt className="text-muted">Crown jewels</dt>
          <dd className="tabular-nums text-ink">{a.jewels.length}</dd>
          <dt className="text-muted">Questions answered</dt>
          <dd className="tabular-nums text-ink">{answered} of {questions.length}</dd>
          <dt className="text-muted">Last saved</dt>
          <dd className="text-ink">{relativeTime(a.updatedAt, now)}</dd>
        </dl>
        {questions.length > 0 && (
          <div className="mt-5 h-1 overflow-hidden rounded-full bg-rule" aria-hidden>
            <div className="h-full bg-accent" style={{ width: `${Math.round((answered / questions.length) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-paper px-7 py-4">
        <Button onClick={onContinue} autoFocus>Continue where you left off</Button>
        <Button variant="secondary" onClick={onSave}>Save file</Button>
        <Button variant="ghost" className="sm:ml-auto" onClick={onNew}>Start a new assessment</Button>
      </div>
      <p className="border-t border-rule px-7 py-3 text-xs leading-relaxed text-muted">
        Progress is kept in this browser only. To continue on another computer, or to keep a copy, use <strong className="font-medium text-ink-2">Save file</strong> and open it later.
      </p>
    </div>
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
  const [fileSave, setFileSave] = useState<{ file: string; at: string; downloaded: boolean }>();
  const [saver] = useState(createFileSaver);
  const View = views[step] ?? OrgStep;

  /** Save to a file without leaving the current step, question or scroll position. */
  const saveFile = useCallback(async () => {
    const a = useStore.getState().assessment;
    const result = await saver.save(saveFileName(a), JSON.stringify(a, null, 2));
    if (result.kind === "cancelled") return;
    setFileSave({ file: result.file, at: new Date().toISOString(), downloaded: result.kind === "downloaded" });
  }, [saver]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveFile]);

  useEffect(() => {
    const open = () => fileInput.current?.click();
    window.addEventListener(OPEN_FILE_EVENT, open);
    return () => window.removeEventListener(OPEN_FILE_EVENT, open);
  }, []);
  const go = (i: number) => {
    setStep(i);
    window.scrollTo({ top: 0 });
  };

  async function onOpen(file: File) {
    setNotice(undefined);
    try {
      const parsed = assessmentSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "unrecognised format");
      load(parsed.data);
      saver.reset();
      setFileSave(undefined);
      setResuming(false);
      // Read the step back from the store: load() moves positions saved under an older step list.
      setNotice({ kind: "ok", text: `Opened ${parsed.data.org.name || "assessment"}. Picking up at ${steps[clampStep(useStore.getState().assessment.progress?.step)]}.` });
    } catch (e) {
      setNotice({ kind: "error", text: `Couldn't open that file: ${(e as Error).message}` });
    }
  }

  function startNew() {
    if (!hasProgress(assessment) || confirm("Start a new assessment? The current one will be removed from this browser. Choose Cancel, then Save file, if you want to keep it.")) {
      reset();
      saver.reset();
      setFileSave(undefined);
      setResuming(false);
      setNotice(undefined);
    }
  }

  function onClear() {
    if (confirm("Delete this assessment from this browser? Use Save file first if you want to keep it.")) {
      reset();
      saver.reset();
      setFileSave(undefined);
      setNotice(undefined);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <div className="mr-auto flex min-w-0 items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7 shrink-0" />
            <div className="min-w-0">
              <div className="font-display text-[0.9375rem] font-semibold leading-tight tracking-[-0.01em] text-ink">crownguard</div>
              <SaveStatus persisted={persisted} fileSave={fileSave} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void saveFile()} title="Save your progress to a file you can open later (Ctrl/⌘ S). You stay where you are.">
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
        </div>
        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`border-t px-4 py-2 text-sm sm:px-6 ${notice.kind === "error" ? "border-danger/20 bg-danger-soft text-danger" : "border-ok/20 bg-ok-soft text-ok"}`}
          >
            <div className="mx-auto max-w-6xl">{notice.text}</div>
          </div>
        )}
      </header>

      {resuming ? (
        <div className="px-4 py-10 sm:px-6">
          <ResumeCard onContinue={() => setResuming(false)} onSave={() => void saveFile()} onNew={startNew} />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-6 px-4 py-8 sm:px-6 lg:grid-cols-[208px_minmax(0,1fr)] lg:py-12">
          <nav aria-label="Steps" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <ol className="-mx-1 flex gap-0.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:px-0 lg:pb-0">
              {steps.map((label, i) => {
                const current = i === step;
                const done = i < step;
                return (
                  <li key={label} className="shrink-0">
                    <button
                      type="button"
                      disabled={i > reachable}
                      aria-current={current ? "step" : undefined}
                      onClick={() => go(i)}
                      className={`relative flex w-full items-center gap-3 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-2 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 lg:rounded-none lg:border-l-2 lg:pl-4 ${
                        current
                          ? "bg-accent-soft font-medium text-ink lg:border-accent lg:bg-transparent"
                          : "text-ink-2 lg:border-rule [@media(hover:hover)]:enabled:hover:text-ink [@media(hover:hover)]:enabled:hover:bg-sunken lg:[@media(hover:hover)]:enabled:hover:bg-transparent lg:[@media(hover:hover)]:enabled:hover:border-ink-2"
                      }`}
                    >
                      <span className={`w-4 shrink-0 font-mono text-[0.6875rem] tabular-nums ${current ? "text-accent" : done ? "text-ok" : "text-muted"}`}>
                        {done ? "✓" : pad(i + 1)}
                      </span>
                      {label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <main className="min-w-0">
            <p className="mono-label mb-2 text-muted">
              Step {pad(step + 1)} / {pad(steps.length)}
            </p>
            <View />
            <div className="mt-12 flex items-center justify-between gap-3 border-t border-rule pt-5">
              <Button variant="ghost" disabled={step === 0} onClick={() => go(step - 1)}>
                ← Back
              </Button>
              {step < steps.length - 1 && (
                <Button disabled={step + 1 > reachable} onClick={() => go(step + 1)}>
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

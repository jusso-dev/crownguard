import { useCallback, useEffect, useRef, useState } from "react";
import { catalogue, contentHash } from "./content/catalogue";
import { questionIdSet } from "./content/questionIds";
import { activeQuestions, effectiveAnswers } from "./engine/risk";
import type { Assessment, Mode } from "./engine/types";
import { SCHEMA_VERSION } from "./wizard/assessmentSchema";
import { parseAssessment } from "./wizard/parseAssessment";
import { rehydrateNotices } from "./wizard/persistence";
import { toSaveFile } from "./wizard/saveFile";
import { clampStep, hasProgress, modeOf, stepsFor, storageAvailable, useStep, useStore } from "./wizard/store";
import { Button, Card } from "./wizard/ui";
import { createFileSaver, download, OPEN_FILE_EVENT, slug } from "./wizard/download";
import { OrgStep } from "./wizard/steps/OrgStep";
import { EnvironmentStep } from "./wizard/steps/EnvironmentStep";
import { JewelsStep } from "./wizard/steps/JewelsStep";
import { ControlsStep } from "./wizard/steps/ControlsStep";
import { ReviewStep } from "./wizard/steps/ReviewStep";
import { SocStep } from "./wizard/steps/SocStep";
import { AiRegisterStep } from "./wizard/steps/AiRegisterStep";
import { BrandingStep } from "./wizard/steps/BrandingStep";
import { ReportStep } from "./wizard/steps/ReportStep";
import { relativeTime } from "./wizard/time";

// One view per entry in each step list (wizard/store.ts), in the same order.
const views = [OrgStep, EnvironmentStep, JewelsStep, ControlsStep, SocStep, AiRegisterStep, ReviewStep, BrandingStep, ReportStep];
const aiViews = [OrgStep, AiRegisterStep, ReviewStep, BrandingStep, ReportStep];
const viewsFor = (mode: Mode) => (mode === "ai-register" ? aiViews : views);

/** A step can be entered once the steps before it have their minimum inputs. */
function useReachable(): number {
  const a = useStore((s) => s.assessment);
  const mode = modeOf(a);
  if (!a.org.name.trim()) return 0;
  // The standalone register needs nothing else: no platform, crown jewels or Controls answers.
  if (mode === "full") {
    if (!a.platforms.length) return 1;
    if (!a.jewels.length) return 2;
  }
  return stepsFor(mode).length - 1;
}

const saveFileName = (a: Assessment) =>
  modeOf(a) === "ai-register" ? `${slug(a.org.name)}-ai-register.crownguard.json` : `${slug(a.org.name)}.crownguard.json`;

/** Start a fresh assessment in the flow given. The register itself is started on its step, as in the full assessment. */
function startAssessment(mode: Mode) {
  const s = useStore.getState();
  s.reset();
  s.setMode(mode, 0);
}

/**
 * The `#/ai-register` link: read once when the app loads, then cleared from the address bar so a refresh doesn't
 * fight saved progress. `true` means the link wants the standalone AI register flow.
 */
const linkedAiRegister = (() => {
  if (window.location.hash !== "#/ai-register") return false;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return true;
})();

/** A message in the header bar. `details` are the individual problems; `actions` are what the user can do about it. */
interface Notice {
  kind: "error" | "ok" | "warn";
  text: string;
  details?: string[];
  actions?: { label: string; onClick: () => void }[];
}

const noticeStyle: Record<Notice["kind"], string> = {
  error: "border-danger/20 bg-danger-soft text-danger",
  warn: "border-warn/20 bg-warn-soft text-warn",
  ok: "border-ok/20 bg-ok-soft text-ok",
};

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

function ResumeCard({ onContinue, onSave, onNew, onStartRegister }: { onContinue: () => void; onSave: () => void; onNew: () => void; onStartRegister?: () => void }) {
  const a = useStore((s) => s.assessment);
  const now = useNow();
  const questions = activeQuestions(catalogue, a);
  const answers = effectiveAnswers(a);
  const answered = questions.filter((q) => answers[q.id]).length;
  const at = clampStep(a.progress?.step, modeOf(a));
  return (
    <div className="mx-auto mt-4 max-w-xl overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface">
      <div className="p-7">
        <p className="mono-label text-accent">Welcome back</p>
        <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight">{a.org.name || "Your assessment"}</h1>
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
          <dt className="text-muted">You were on</dt>
          <dd className="text-ink">
            <span className="mr-2 font-mono text-xs text-muted">{pad(at + 1)}</span>
            <span>{stepsFor(modeOf(a))[at]}</span>
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
      {onStartRegister && (
        <div className="border-t border-rule bg-paper px-7 py-4 text-sm text-ink-2">
          <p>
            You followed a link to the AI use-case register. Starting it gives you a fresh, standalone register and removes
            this assessment from this browser — use <strong className="font-medium text-ink">Save file</strong> first to keep it.
          </p>
          <Button variant="secondary" className="mt-3" onClick={onStartRegister}>
            Start an AI use-case register instead
          </Button>
        </div>
      )}
      <p className="border-t border-rule px-7 py-3 text-xs leading-relaxed text-muted">
        Progress is kept in this browser only. To continue on another computer, or to keep a copy, use <strong className="font-medium text-ink-2">Save file</strong> and open it later.
      </p>
    </div>
  );
}

/** The first-run choice: the full crown-jewel assessment, or the standalone AI use-case register. */
function StartCard({ onPick }: { onPick: (mode: Mode) => void }) {
  return (
    <div className="mx-auto mt-4 max-w-2xl">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface">
        <div className="p-7">
          <p className="mono-label text-accent">Start</p>
          <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight">What would you like to do?</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">
            Everything runs in this browser, and nothing you enter is sent anywhere. You can switch from the register to
            the full assessment later without losing anything.
          </p>
        </div>
        <div className="grid gap-px border-t border-rule bg-rule sm:grid-cols-2">
          <Card className="flex flex-col rounded-none! border-0!">
            <p className="flex-1 text-sm leading-relaxed text-ink-2">
              Name the crown jewels whose loss would hurt most, check how well your Microsoft, Google or AWS environment
              protects them, and get a risk report. Includes the AI use-case register as an optional step.
            </p>
            <Button className="mt-4 self-start" onClick={() => onPick("full")}>Full crown-jewel assessment</Button>
          </Card>
          <Card className="flex flex-col rounded-none! border-0!">
            <p className="flex-1 text-sm leading-relaxed text-ink-2">
              Record each AI use case against the DTA&apos;s Standard for accountability and get a register PDF, plus CSV
              and XLSX for your own records. No platform, crown jewels or controls questions needed — only an
              organisation name.
            </p>
            <Button className="mt-4 self-start" onClick={() => onPick("ai-register")}>AI use-case register only</Button>
          </Card>
        </div>
        <p className="border-t border-rule px-7 py-3 text-xs leading-relaxed text-muted">
          Not sure? Start with the AI use-case register — it&apos;s the shorter flow, and it can become a full
          crown-jewel assessment later.
        </p>
      </div>
    </div>
  );
}

/** Anything the last rehydrate couldn't use: stale, hand-edited, or written by something else on this origin. */
function noticeFromRehydrate(): Notice | undefined {
  const notices = rehydrateNotices();
  if (!notices.length) return undefined;
  const first = notices.find((n) => n.kind === "error") ?? notices[0];
  const backup = notices.find((n) => n.backup)?.backup;
  return {
    kind: first.kind === "error" ? "error" : "warn",
    text: first.text,
    details: notices.filter((n) => n !== first).map((n) => n.text),
    actions: backup
      ? [{ label: "Download the unreadable data", onClick: () => download("crownguard-unreadable.json", backup, "application/json") }]
      : undefined,
  };
}

export function App() {
  const { assessment, setStep, load, reset } = useStore();
  const step = useStep();
  const reachable = useReachable();
  const mode = modeOf(assessment);
  const steps = stepsFor(mode);
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | undefined>(noticeFromRehydrate);
  const [persisted] = useState(storageAvailable);
  const [screen, setScreen] = useState<"start" | "resume" | "wizard">(() => (hasProgress(useStore.getState().assessment) ? "resume" : linkedAiRegister ? "wizard" : "start"));
  const [fileSave, setFileSave] = useState<{ file: string; at: string; downloaded: boolean }>();
  const [saver] = useState(createFileSaver);
  const readOnly = useStore((s) => s.readOnly);
  const View = viewsFor(mode)[step] ?? OrgStep;

  // The deep link starts the standalone register on a fresh visit. With a saved assessment it only asks (see ResumeCard).
  const linked = useRef(false);
  useEffect(() => {
    if (!linkedAiRegister || linked.current) return;
    linked.current = true;
    if (screen !== "resume") startAssessment("ai-register");
  }, [screen]);

  /** Save to a file without leaving the current step, question or scroll position. */
  const saveFile = useCallback(async () => {
    const a = useStore.getState().assessment;
    if (useStore.getState().readOnly) {
      setNotice({
        kind: "error",
        text: "This assessment was opened read-only from a newer crownguard, so it can't be saved from here. Reload the page to update crownguard, then open the file again.",
      });
      return;
    }
    const result = await saver.save(saveFileName(a), toSaveFile(a, { contentHash }));
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

  /** Show a file this build only partly understands, without any risk of writing it back over the user's work. */
  function openReadOnly(a: Assessment) {
    useStore.getState().setReadOnly(true);
    load(a);
    saver.reset();
    setFileSave(undefined);
    setScreen("wizard");
    setNotice({
      kind: "warn",
      text: `Opened ${a.org.name || "assessment"} read-only. Nothing will be saved from here — reload the page to update crownguard before you work on this file.`,
    });
  }

  async function onOpen(file: File) {
    setNotice(undefined);
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setNotice({ kind: "error", text: "Couldn't open that file: it isn't valid JSON." });
      return;
    }

    const parsed = parseAssessment(raw, { questionIds: questionIdSet() });
    if (parsed.kind === "error") {
      setNotice({ kind: "error", text: `Couldn't open that file: ${parsed.message}`, details: parsed.issues });
      return;
    }

    if (parsed.kind === "newer") {
      const ahead = parsed.assessment;
      const actions: Notice["actions"] = [];
      if (ahead) actions.push({ label: "Open read-only", onClick: () => openReadOnly(ahead) });
      actions.push({ label: "Cancel", onClick: () => setNotice(undefined) });
      setNotice({
        kind: "warn",
        text: `This file was saved by a newer version of crownguard (format ${parsed.schemaVersion}; this one reads format ${SCHEMA_VERSION}). Reload the page to update, or open it here knowing that anything this version doesn't understand is at risk.`,
        details: parsed.issues,
        actions,
      });
      return;
    }

    load(parsed.assessment);
    if (useStore.getState().readOnly) useStore.getState().setReadOnly(false);
    saver.reset();
    setFileSave(undefined);
    setScreen("wizard");
    const opened = useStore.getState().assessment;
    const stepName = stepsFor(modeOf(opened))[clampStep(opened.progress?.step, modeOf(opened))];
    setNotice({
      kind: parsed.notices.some((n) => n.kind === "warn") ? "warn" : "ok",
      // Read the step back from the store: load() moves positions saved under an older step list.
      text: `Opened ${parsed.assessment.org.name || "assessment"}. Picking up at ${stepName}.`,
      details: parsed.notices.map((n) => n.text),
    });
  }

  function startNew() {
    if (!hasProgress(assessment) || confirm("Start a new assessment? The current one will be removed from this browser. Choose Cancel, then Save file, if you want to keep it.")) {
      reset();
      saver.reset();
      setFileSave(undefined);
      setScreen("start");
      setNotice(undefined);
    }
  }

  /** The deep link on a resumed assessment: start the standalone register only after the user confirms it. */
  function startLinkedRegister() {
    if (confirm("Start a fresh AI use-case register? The assessment saved in this browser will be removed. Choose Cancel, then Save file, if you want to keep it.")) {
      startAssessment("ai-register");
      saver.reset();
      setFileSave(undefined);
      setScreen("wizard");
      setNotice(undefined);
    }
  }

  function onClear() {
    if (confirm("Delete this assessment from this browser? Use Save file first if you want to keep it.")) {
      reset();
      saver.reset();
      setFileSave(undefined);
      setScreen("start");
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
            <Button
              variant="secondary"
              disabled={readOnly}
              onClick={() => void saveFile()}
              title={readOnly ? "This file came from a newer crownguard and can't be saved from here" : "Save your progress to a file you can open later (Ctrl/⌘ S). You stay where you are."}
            >
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
            <Button variant="danger" disabled={readOnly} onClick={onClear}>
              Clear data
            </Button>
          </div>
        </div>
        {notice && (
          <div role={notice.kind === "error" ? "alert" : "status"} className={`border-t px-4 py-2 text-sm sm:px-6 ${noticeStyle[notice.kind]}`}>
            <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1">
                <p>{notice.text}</p>
                {notice.details && notice.details.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 font-mono text-[0.6875rem] leading-relaxed opacity-80">
                    {notice.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
              {notice.actions && notice.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {notice.actions.map((a) => (
                    <Button key={a.label} variant="secondary" onClick={a.onClick}>
                      {a.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {screen === "resume" ? (
        <div className="px-4 py-10 sm:px-6">
          <ResumeCard
            onContinue={() => setScreen("wizard")}
            onSave={() => void saveFile()}
            onNew={startNew}
            {...(linkedAiRegister ? { onStartRegister: startLinkedRegister } : {})}
          />
        </div>
      ) : screen === "start" ? (
        <div className="px-4 py-10 sm:px-6">
          <StartCard
            onPick={(m) => {
              startAssessment(m);
              setScreen("wizard");
            }}
          />
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

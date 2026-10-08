import { useRef, useState } from "react";
import { assessmentSchema } from "./wizard/assessmentSchema";
import { steps, useStore } from "./wizard/store";
import { Button } from "./wizard/ui";
import { OrgStep } from "./wizard/steps/OrgStep";
import { EnvironmentStep } from "./wizard/steps/EnvironmentStep";
import { JewelsStep } from "./wizard/steps/JewelsStep";
import { ControlsStep } from "./wizard/steps/ControlsStep";
import { ReviewStep } from "./wizard/steps/ReviewStep";
import { BrandingStep } from "./wizard/steps/BrandingStep";
import { ReportStep } from "./wizard/steps/ReportStep";
import { download, slug } from "./wizard/download";

const views = [OrgStep, EnvironmentStep, JewelsStep, ControlsStep, ReviewStep, BrandingStep, ReportStep];

/** A step can be entered once the steps before it have their minimum inputs. */
function useReachable(): number {
  const a = useStore((s) => s.assessment);
  if (!a.org.name.trim()) return 0;
  if (!a.platforms.length) return 1;
  if (!a.jewels.length) return 2;
  return steps.length - 1;
}

export function App() {
  const { step, setStep, assessment, load, reset } = useStore();
  const reachable = useReachable();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string>();
  const View = views[step] ?? OrgStep;

  async function onImport(file: File) {
    setImportError(undefined);
    try {
      const parsed = assessmentSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "unrecognised format");
      load(parsed.data);
    } catch (e) {
      setImportError(`Couldn't import that file: ${(e as Error).message}`);
    }
  }

  function onClear() {
    if (confirm("Delete this assessment from this browser? Export it first if you want to keep it.")) reset();
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="mr-auto">
            <div className="font-semibold tracking-tight">crownguard</div>
            <div className="text-xs text-ink-soft">Crown-jewel risk assessment · runs entirely in your browser</div>
          </div>
          <Button variant="secondary" onClick={() => download(`${slug(assessment.org.name)}.crownguard.json`, JSON.stringify(assessment, null, 2), "application/json")}>
            Export
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="import-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = "";
            }}
          />
          <Button variant="danger" onClick={onClear}>
            Clear data
          </Button>
        </div>
        {importError && <div className="bg-red-50 px-6 py-2 text-sm text-red-800">{importError}</div>}
      </header>

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
              <Button disabled={step + 1 > reachable} onClick={() => setStep(step + 1)}>
                Next: {steps[step + 1]} →
              </Button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

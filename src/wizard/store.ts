import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SocAnswer, SocProvider } from "../engine/soc";
import type { AiKind } from "../content/schema";
import { exampleEntries } from "../engine/aiExamples";
import { newUseCase } from "../engine/aiRegister";
import type { AiUseCase, Answer, Assessment, Branding, CrownJewel, OrgProfile } from "../engine/types";
import type { ScanResult } from "../imports/types";
import { NOTE_MAX, SCHEMA_VERSION } from "./assessmentSchema";
import { checkedStorage, setStorageReadOnly, STORAGE_KEY } from "./persistence";

export { STORAGE_KEY };

export const steps = ["Organisation", "Environment", "Crown jewels", "Controls", "SOC maturity", "AI register", "Review", "Branding", "Report"] as const;

/** Version of the step list. Layout 2 added "SOC maturity" after Controls; layout 3 added "AI register" after it. */
export const STEP_LAYOUT = 3;

/** Move a saved position onto the current step list: each added step moves positions saved after it on by one. */
export function migrateProgress(p: Assessment["progress"]): Assessment["progress"] {
  if (!p) return p;
  const layout = p.layout ?? 1;
  let step = p.step;
  if (layout < 2 && step >= 4) step++;
  if (layout < 3 && step >= 5) step++;
  return { ...p, step, layout: STEP_LAYOUT };
}

export const emptyAssessment = (): Assessment => {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    org: { name: "", sector: "", size: "", jurisdiction: "Australia", regulations: [] },
    platforms: [],
    modules: {},
    licence: {},
    jewels: [],
    answers: {},
    notes: {},
    branding: { primary: "#1f3a5f", accent: "#d97706", marking: "OFFICIAL: Sensitive", preparedBy: "", preparedFor: "" },
    progress: { step: 0, layout: STEP_LAYOUT },
    createdAt: now,
    updatedAt: now,
  };
};

/** True when this browser lets us keep progress between visits (false in some private windows or locked-down profiles). */
export function storageAvailable(): boolean {
  try {
    const k = `${STORAGE_KEY}:probe`;
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Whether there's a started assessment worth offering to resume. */
export const hasProgress = (a: Assessment) => a.org.name.trim() !== "" || a.jewels.length > 0 || Object.keys(a.answers).length > 0;

export const clampStep = (n: number | undefined) => Math.min(steps.length - 1, Math.max(0, Math.trunc(n ?? 0)));

/** The SOC block, or an empty one to change. */
const soc = (a: Assessment): NonNullable<Assessment["soc"]> => a.soc ?? { answers: {}, outOfScope: [] };

/** Change one AI register entry. */
const editEntry = (a: Assessment, id: string, fn: (e: AiUseCase) => AiUseCase): Partial<Assessment> => ({
  aiRegister: { entries: (a.aiRegister?.entries ?? []).map((e) => (e.id === id ? fn(e) : e)) },
});

interface State {
  assessment: Assessment;
  setStep: (step: number) => void;
  setSection: (section: string) => void;
  /** The open SOC maturity domain, kept apart from the Controls section so each step resumes where it was left. */
  setSocSection: (domain: string) => void;
  update: (fn: (a: Assessment) => Partial<Assessment>) => void;
  setOrg: (org: Partial<OrgProfile>) => void;
  setBranding: (b: Partial<Branding>) => void;
  setAnswer: (questionId: string, answer: Answer) => void;
  /** Turn the optional SOC maturity assessment on or off. Turning it off keeps nothing. */
  setSocIncluded: (included: boolean) => void;
  setSocAnswer: (questionId: string, answer: SocAnswer) => void;
  setSocNote: (questionId: string, note: string) => void;
  setSocScope: (aspectId: string, inScope: boolean) => void;
  /** Override a domain's target; undefined goes back to the model's default. */
  setSocTarget: (domainId: string, kind: "maturity" | "capability", value: number | undefined) => void;
  setSocProvider: (provider: SocProvider | undefined) => void;
  setNote: (questionId: string, note: string) => void;
  /** Turn the optional AI use-case register on or off. Turning it off keeps nothing. */
  setAiIncluded: (included: boolean) => void;
  /** Register-level fields: when it was created, when it was last shared with the DTA, who confirmed the dates. */
  updateAiRegister: (patch: Partial<NonNullable<Assessment["aiRegister"]>>) => void;
  /** The open AI register entry, so the step resumes on it. */
  setAiSection: (entryId: string) => void;
  /** Add an entry from a preset and open it. Returns its id. */
  addAiUseCase: (kind: AiKind) => string;
  updateAiUseCase: (id: string, patch: Partial<Omit<AiUseCase, "id" | "example">>) => void;
  removeAiUseCase: (id: string) => void;
  setAiAnswer: (id: string, questionId: string, answer: Answer) => void;
  setAiNote: (id: string, questionId: string, note: string) => void;
  /** Add the example entries (replacing any already loaded), starting the register if needed. */
  loadAiExamples: () => void;
  removeAiExamples: () => void;
  upsertJewel: (jewel: CrownJewel) => void;
  removeJewel: (id: string) => void;
  /** Apply an automated scan: attach evidence everywhere, set answers where decisive. Returns answers set. */
  applyScan: (scan: ScanResult, opts: { platform: string; overwrite: boolean; licence: boolean }) => number;
  load: (a: Assessment) => void;
  /**
   * Open something that must not be written back over the user's own progress: a file saved by a newer crownguard.
   * While this is set, nothing is written to this browser or to the open file, until the page is reloaded.
   */
  setReadOnly: (readOnly: boolean) => void;
  readOnly: boolean;
  reset: () => void;
}

export const useStore = create<State>()(
  persist(
    (set) => {
      const update: State["update"] = (fn) =>
        set((s) => ({ assessment: { ...s.assessment, ...fn(s.assessment), updatedAt: new Date().toISOString() } }));
      return {
        assessment: emptyAssessment(),
        readOnly: false,
        setReadOnly: (readOnly) => {
          setStorageReadOnly(readOnly);
          set({ readOnly });
        },
        setStep: (step) => update((a) => ({ progress: { ...a.progress, step: clampStep(step), layout: STEP_LAYOUT } })),
        setSection: (section) => update((a) => ({ progress: { ...a.progress, step: a.progress?.step ?? 0, section, layout: STEP_LAYOUT } })),
        setSocSection: (socSection) => update((a) => ({ progress: { ...a.progress, step: a.progress?.step ?? 0, socSection, layout: STEP_LAYOUT } })),
        update,
        setOrg: (org) => update((a) => ({ org: { ...a.org, ...org } })),
        setBranding: (b) => update((a) => ({ branding: { ...a.branding, ...b } })),
        setAnswer: (id, answer) => update((a) => ({ answers: { ...a.answers, [id]: answer } })),
        setNote: (id, note) => update((a) => ({ notes: { ...a.notes, [id]: note.slice(0, NOTE_MAX) } })),
        setSocIncluded: (included) => update((a) => ({ soc: included ? (a.soc ?? { answers: {}, outOfScope: [] }) : undefined })),
        setSocAnswer: (id, answer) => update((a) => ({ soc: { ...soc(a), answers: { ...a.soc?.answers, [id]: answer } } })),
        setSocNote: (id, note) => update((a) => ({ soc: { ...soc(a), notes: { ...a.soc?.notes, [id]: note.slice(0, NOTE_MAX) } } })),
        setSocScope: (aspect, inScope) =>
          update((a) => {
            const out = new Set(soc(a).outOfScope);
            if (inScope) out.delete(aspect);
            else out.add(aspect);
            return { soc: { ...soc(a), outOfScope: [...out].sort() } };
          }),
        setSocTarget: (domain, kind, value) =>
          update((a) => {
            const target = { ...a.soc?.targets?.[domain], [kind]: value };
            if (value === undefined) delete target[kind];
            return { soc: { ...soc(a), targets: { ...a.soc?.targets, [domain]: target } } };
          }),
        setSocProvider: (provider) => update((a) => ({ soc: { ...soc(a), provider } })),
        setAiIncluded: (included) =>
          update((a) => ({
            // Turning the register on starts the DTA's six-monthly sharing clock, so the date it was created is
            // recorded then and can be edited afterwards if the agency keeps its own.
            aiRegister: included ? { createdAt: new Date().toISOString().slice(0, 10), ...a.aiRegister, entries: a.aiRegister?.entries ?? [] } : undefined,
          })),
        updateAiRegister: (patch) => update((a) => ({ aiRegister: { entries: a.aiRegister?.entries ?? [], ...a.aiRegister, ...patch } })),
        setAiSection: (aiSection) => update((a) => ({ progress: { ...a.progress, step: a.progress?.step ?? 0, aiSection, layout: STEP_LAYOUT } })),
        addAiUseCase: (kind) => {
          const id = crypto.randomUUID();
          update((a) => ({
            aiRegister: { entries: [...(a.aiRegister?.entries ?? []), newUseCase(kind, id)] },
            progress: { ...a.progress, step: a.progress?.step ?? 0, aiSection: id, layout: STEP_LAYOUT },
          }));
          return id;
        },
        updateAiUseCase: (id, patch) => update((a) => editEntry(a, id, (e) => ({ ...e, ...patch }))),
        removeAiUseCase: (id) => update((a) => ({ aiRegister: { entries: (a.aiRegister?.entries ?? []).filter((e) => e.id !== id) } })),
        setAiAnswer: (id, q, answer) => update((a) => editEntry(a, id, (e) => ({ ...e, answers: { ...e.answers, [q]: answer } }))),
        setAiNote: (id, q, note) => update((a) => editEntry(a, id, (e) => ({ ...e, notes: { ...e.notes, [q]: note.slice(0, NOTE_MAX) } }))),
        loadAiExamples: () =>
          update((a) => {
            const examples = exampleEntries(a);
            return {
              aiRegister: { entries: [...(a.aiRegister?.entries ?? []).filter((e) => !e.example), ...examples] },
              progress: { ...a.progress, step: a.progress?.step ?? 0, aiSection: examples[0].id, layout: STEP_LAYOUT },
            };
          }),
        removeAiExamples: () => update((a) => ({ aiRegister: { entries: (a.aiRegister?.entries ?? []).filter((e) => !e.example) } })),
        upsertJewel: (j) =>
          update((a) => ({
            jewels: a.jewels.some((x) => x.id === j.id) ? a.jewels.map((x) => (x.id === j.id ? j : x)) : [...a.jewels, j],
          })),
        removeJewel: (id) =>
          update((a) => ({
            jewels: a.jewels.filter((j) => j.id !== id),
            ...(a.aiRegister && { aiRegister: { entries: a.aiRegister.entries.map((e) => (e.jewels.includes(id) ? { ...e, jewels: e.jewels.filter((x) => x !== id) } : e)) } }),
          })),
        applyScan: (scan, { platform, overwrite, licence }) => {
          let applied = 0;
          update((a) => {
            const answers = { ...a.answers };
            const evidence = { ...a.evidence };
            for (const { question, evidence: ev } of scan.suggestions) {
              evidence[question] = ev;
              if (ev.suggested && (overwrite || !answers[question])) {
                answers[question] = ev.suggested;
                applied++;
              }
            }
            const now = new Date().toISOString();
            return {
              answers,
              evidence,
              licence: licence && scan.licence ? { ...a.licence, [platform]: scan.licence } : a.licence,
              imports: [...(a.imports ?? []), { source: scan.tool, toolVersion: scan.toolVersion, tenant: scan.tenant, scannedAt: scan.scannedAt, importedAt: now, applied }],
            };
          });
          return applied;
        },
        load: (assessment) => {
          const progress = migrateProgress(assessment.progress ?? { step: 0 })!;
          set({ assessment: { ...assessment, progress: { ...progress, step: clampStep(progress.step) } } });
        },
        reset: () => set({ assessment: emptyAssessment() }),
      };
    },
    {
      name: STORAGE_KEY,
      version: 3,
      storage: checkedStorage,
      // Only the assessment is persisted; older saves kept the step beside it.
      partialize: (s) => ({ assessment: s.assessment }),
      migrate: (persisted, version) => {
        const p = persisted as { assessment: Assessment; step?: number };
        if (version === 0 && p.assessment && !p.assessment.progress) p.assessment.progress = { step: clampStep(p.step) };
        // migrateProgress reads the saved layout, so running it again on newer saves is harmless.
        if (version < 3 && p.assessment) p.assessment.progress = migrateProgress(p.assessment.progress);
        return { assessment: p.assessment } as State;
      },
    },
  ),
);

export const useStep = () => useStore((s) => clampStep(s.assessment.progress?.step));

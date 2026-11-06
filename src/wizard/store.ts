import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SocAnswer, SocProvider } from "../format/vocab";
import type { AiKind } from "../content/schema";
import { exampleEntries } from "../engine/aiExamples";
import { newUseCase } from "../engine/aiRegister";
import type { Answer, Mode } from "../format/vocab";
import type { AiUseCase, Assessment, Branding, CrownJewel, OrgProfile } from "../format/schema";
import { applyScan as mergeScan } from "../imports/apply";
import type { ScanResult } from "../imports/types";
import { isDesktop, platform } from "../platform";
import { NOTE_MAX } from "../format/schema";
import { emptyAssessment, STEP_LAYOUT } from "../format/empty";
import { checkedStorage, setStorageReadOnly, STORAGE_KEY } from "./persistence";

export { STORAGE_KEY, emptyAssessment, STEP_LAYOUT };

export const fullSteps = ["Organisation", "Environment", "Crown jewels", "Controls", "SOC maturity", "AI register", "Review", "Branding", "Report"] as const;

/** The standalone AI register flow: no platforms, crown jewels or Controls, and the register is the point of it. */
export const aiSteps = ["Organisation", "AI register", "Review", "Branding", "Report"] as const;

/** The step list for a flow. Every step number in a saved file is an index into the list its mode was saved with. */
export const stepsFor = (mode: Mode = "full"): readonly string[] => (mode === "ai-register" ? aiSteps : fullSteps);

/** Which flow this assessment runs in. Files saved before the standalone flow existed carry no mode and are full. */
export const modeOf = (a: Assessment): Mode => a.mode ?? "full";

/**
 * Move a saved position onto the current step list: each added step moves positions saved after it on by one.
 *
 * The standalone list was introduced with layout 3 and has never changed, so its positions move nowhere yet; when it
 * does, the `ai-register` branch maps them here, the way the full list does below.
 */
export function migrateProgress(p: Assessment["progress"], mode: Mode = "full"): Assessment["progress"] {
  if (!p) return p;
  if (mode === "ai-register") return { ...p, layout: STEP_LAYOUT };
  const layout = p.layout ?? 1;
  let step = p.step;
  if (layout < 2 && step >= 4) step++;
  if (layout < 3 && step >= 5) step++;
  return { ...p, step, layout: STEP_LAYOUT };
}

/** True when this browser lets us keep progress between visits (false in some private windows or locked-down profiles). */
export function storageAvailable(): boolean {
  try {
    const k = `${STORAGE_KEY}:probe`;
    const store = platform.autosave();
    if (!store) return false;
    store.setItem(k, "1");
    store.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** Whether there's a started assessment worth offering to resume. */
export const hasProgress = (a: Assessment) =>
  a.org.name.trim() !== "" || a.jewels.length > 0 || Object.keys(a.answers).length > 0 || (a.aiRegister?.entries.length ?? 0) > 0;

export const clampStep = (n: number | undefined, mode: Mode = "full") => Math.min(stepsFor(mode).length - 1, Math.max(0, Math.trunc(n ?? 0)));

/** The furthest step that can be entered: a step needs the minimum inputs of the steps before it. */
export function reachableStep(a: Assessment): number {
  const mode = modeOf(a);
  if (!a.org.name.trim()) return 0;
  // The standalone register needs nothing else: no platform, crown jewels or Controls answers.
  if (mode === "full") {
    if (!a.platforms.length) return 1;
    if (!a.jewels.length) return 2;
  }
  return stepsFor(mode).length - 1;
}

/** The step to show: the saved position, kept inside the step list and no further than `reachableStep`. */
export const currentStep = (a: Assessment) => Math.min(clampStep(a.progress?.step, modeOf(a)), reachableStep(a));

/** The SOC block, or an empty one to change. */
const soc = (a: Assessment): NonNullable<Assessment["soc"]> => a.soc ?? { answers: {}, outOfScope: [] };

/** Change one AI register entry. */
const editEntry = (a: Assessment, id: string, fn: (e: AiUseCase) => AiUseCase): Partial<Assessment> => ({
  aiRegister: { entries: (a.aiRegister?.entries ?? []).map((e) => (e.id === id ? fn(e) : e)) },
});

interface State {
  assessment: Assessment;
  setStep: (step: number) => void;
  /**
   * Switch between the full assessment and the standalone AI register, at the step given (default: the start).
   * Everything already recorded is kept, so a standalone register can become a full assessment later.
   */
  setMode: (mode: Mode, step?: number) => void;
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
  /**
   * Add an entry pre-filled from the consent import's "Found apps" panel. It keeps the panel and the open entry as
   * they are, so several apps can be added in one sitting. The entry never carries a readiness answer.
   */
  addImportedAiUseCase: (entry: AiUseCase) => void;
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
        setStep: (step) => update((a) => ({ progress: { ...a.progress, step: clampStep(step, modeOf(a)), layout: STEP_LAYOUT } })),
        setMode: (mode, step) =>
          update((a) => ({
            // "full" is the default and is left out of saved files, so older crownguards open them without a warning.
            ...(mode === "ai-register" ? { mode } : { mode: undefined }),
            progress: { ...a.progress, step: clampStep(step ?? 0, mode), layout: STEP_LAYOUT },
          })),
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
        addImportedAiUseCase: (entry) => update((a) => ({ aiRegister: { ...a.aiRegister, entries: [...(a.aiRegister?.entries ?? []), entry] } })),
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
        applyScan: (scan, opts) => {
          let applied = 0;
          set((s) => {
            const merged = mergeScan(s.assessment, scan, opts);
            applied = merged.applied;
            return { assessment: merged.assessment };
          });
          return applied;
        },
        load: (assessment) => {
          const mode = modeOf(assessment);
          const progress = migrateProgress(assessment.progress ?? { step: 0 }, mode)!;
          // A file can say it was on Report with no organisation or crown jewels: open it no further than it can reach.
          set({ assessment: { ...assessment, progress: { ...progress, step: currentStep({ ...assessment, progress }) } } });
        },
        // A fresh assessment is the user's own, so it is never read-only, even after a newer file or newer progress.
        reset: () => {
          setStorageReadOnly(false);
          set({ assessment: emptyAssessment(), readOnly: false });
        },
      };
    },
    {
      name: STORAGE_KEY,
      // v4: storage may wrap the JSON in an encryption envelope; state shape is unchanged.
      version: 4,
      storage: checkedStorage,
      // Desktop progress lives in SQLite, which is ready only after the platform has loaded (main.tsx rehydrates then).
      skipHydration: isDesktop,
      // Only the assessment is persisted; older saves kept the step beside it.
      partialize: (s) => ({ assessment: s.assessment }),
      migrate: (persisted, version) => {
        const p = persisted as { assessment: Assessment; step?: number };
        const mode = p.assessment ? modeOf(p.assessment) : "full";
        if (version === 0 && p.assessment && !p.assessment.progress) p.assessment.progress = { step: clampStep(p.step, mode) };
        // migrateProgress reads the saved layout, so running it again on newer saves is harmless.
        if (version < 3 && p.assessment) p.assessment.progress = migrateProgress(p.assessment.progress, mode);
        // v3 → v4: plain JSON passes through untouched (encryption is a storage-layer concern).
        return { assessment: p.assessment } as State;
      },
    },
  ),
);

export const useStep = () => useStore((s) => currentStep(s.assessment));
export const useReachable = () => useStore((s) => reachableStep(s.assessment));

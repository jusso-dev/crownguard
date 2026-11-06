import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SocAnswer, SocProvider, Answer, Mode } from "../format/vocab";
import type { AiKind } from "../content/schema";
import { exampleEntries } from "../engine/aiExamples";
import { newUseCase } from "../engine/aiRegister";
import { NOTE_MAX, type AiUseCase, type Assessment, type Branding, type CrownJewel, type OrgProfile } from "../format/schema";
import { applyScan as mergeScan } from "../imports/apply";
import type { ScanResult } from "../imports/types";
import { isDesktop, platform } from "../platform";
import { emptyAssessment } from "../format/empty";
import { clampStep, currentStep, migrateProgress, modeOf, reachableStep, STEP_LAYOUT } from "./flow";
import { checkedStorage, setStorageReadOnly, STORAGE_KEY } from "./persistence";


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

/** The SOC block, or an empty one to change. */
const soc = (a: Assessment): NonNullable<Assessment["soc"]> => a.soc ?? { answers: {}, outOfScope: [] };

/** A blank assessment, positioned at the first step of the current step list. */
const blank = (): Assessment => ({ ...emptyAssessment(), progress: { step: 0, layout: STEP_LAYOUT } });

/** Move within the saved position, which always records the current step layout. */
const at = (a: Assessment, patch: Partial<NonNullable<Assessment["progress"]>>): Partial<Assessment> => ({
  progress: { ...a.progress, step: a.progress?.step ?? 0, ...patch, layout: STEP_LAYOUT },
});

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
        assessment: blank(),
        readOnly: false,
        setReadOnly: (readOnly) => {
          setStorageReadOnly(readOnly);
          set({ readOnly });
        },
        setStep: (step) => update((a) => at(a, { step: clampStep(step, modeOf(a)) })),
        setMode: (mode, step) =>
          update((a) => ({
            // "full" is the default and is left out of saved files, so older crownguards open them without a warning.
            ...(mode === "ai-register" ? { mode } : { mode: undefined }),
            ...at(a, { step: clampStep(step ?? 0, mode) }),
          })),
        setSection: (section) => update((a) => at(a, { section })),
        setSocSection: (socSection) => update((a) => at(a, { socSection })),
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
        setAiSection: (aiSection) => update((a) => at(a, { aiSection })),
        addAiUseCase: (kind) => {
          const id = crypto.randomUUID();
          update((a) => ({
            aiRegister: { entries: [...(a.aiRegister?.entries ?? []), newUseCase(kind, id)] },
            ...at(a, { aiSection: id }),
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
              ...at(a, { aiSection: examples[0].id }),
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
          set({ assessment: blank(), readOnly: false });
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

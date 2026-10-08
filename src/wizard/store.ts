import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Answer, Assessment, Branding, CrownJewel, OrgProfile } from "../engine/types";

export const steps = ["Organisation", "Environment", "Crown jewels", "Controls", "Review", "Branding", "Report"] as const;

export const STORAGE_KEY = "crownguard:v1";

export const emptyAssessment = (): Assessment => {
  const now = new Date().toISOString();
  return {
    version: 1,
    org: { name: "", sector: "", size: "", jurisdiction: "Australia", regulations: [] },
    platforms: [],
    modules: {},
    licence: {},
    jewels: [],
    answers: {},
    notes: {},
    branding: { primary: "#1f3a5f", accent: "#d97706", marking: "OFFICIAL: Sensitive", preparedBy: "", preparedFor: "" },
    progress: { step: 0 },
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

interface State {
  assessment: Assessment;
  setStep: (step: number) => void;
  setSection: (section: string) => void;
  update: (fn: (a: Assessment) => Partial<Assessment>) => void;
  setOrg: (org: Partial<OrgProfile>) => void;
  setBranding: (b: Partial<Branding>) => void;
  setAnswer: (questionId: string, answer: Answer) => void;
  setNote: (questionId: string, note: string) => void;
  upsertJewel: (jewel: CrownJewel) => void;
  removeJewel: (id: string) => void;
  load: (a: Assessment) => void;
  reset: () => void;
}

export const useStore = create<State>()(
  persist(
    (set) => {
      const update: State["update"] = (fn) =>
        set((s) => ({ assessment: { ...s.assessment, ...fn(s.assessment), updatedAt: new Date().toISOString() } }));
      return {
        assessment: emptyAssessment(),
        setStep: (step) => update((a) => ({ progress: { ...a.progress, step: clampStep(step) } })),
        setSection: (section) => update((a) => ({ progress: { step: a.progress?.step ?? 0, section } })),
        update,
        setOrg: (org) => update((a) => ({ org: { ...a.org, ...org } })),
        setBranding: (b) => update((a) => ({ branding: { ...a.branding, ...b } })),
        setAnswer: (id, answer) => update((a) => ({ answers: { ...a.answers, [id]: answer } })),
        setNote: (id, note) => update((a) => ({ notes: { ...a.notes, [id]: note } })),
        upsertJewel: (j) =>
          update((a) => ({
            jewels: a.jewels.some((x) => x.id === j.id) ? a.jewels.map((x) => (x.id === j.id ? j : x)) : [...a.jewels, j],
          })),
        removeJewel: (id) => update((a) => ({ jewels: a.jewels.filter((j) => j.id !== id) })),
        load: (assessment) => set({ assessment: { ...assessment, progress: { ...assessment.progress, step: clampStep(assessment.progress?.step) } } }),
        reset: () => set({ assessment: emptyAssessment() }),
      };
    },
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only the assessment is persisted; older saves kept the step beside it.
      partialize: (s) => ({ assessment: s.assessment }),
      migrate: (persisted, version) => {
        const p = persisted as { assessment: Assessment; step?: number };
        if (version === 0 && p.assessment && !p.assessment.progress) p.assessment.progress = { step: clampStep(p.step) };
        return { assessment: p.assessment } as State;
      },
    },
  ),
);

export const useStep = () => useStore((s) => clampStep(s.assessment.progress?.step));

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Answer, Assessment, Branding, CrownJewel, OrgProfile } from "../engine/types";

export const steps = ["Organisation", "Environment", "Crown jewels", "Controls", "Review", "Branding", "Report"] as const;

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
    createdAt: now,
    updatedAt: now,
  };
};

interface State {
  step: number;
  assessment: Assessment;
  setStep: (step: number) => void;
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
        step: 0,
        assessment: emptyAssessment(),
        setStep: (step) => set({ step }),
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
        load: (assessment) => set({ assessment, step: 0 }),
        reset: () => set({ assessment: emptyAssessment(), step: 0 }),
      };
    },
    { name: "crownguard:v1", storage: createJSONStorage(() => localStorage) },
  ),
);

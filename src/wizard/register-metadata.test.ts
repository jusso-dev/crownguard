import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { exampleEntries } from "../engine/aiExamples";
import { newUseCase } from "../engine/aiRegister";
import { emptyAssessment } from "../format/empty";
import { parseAssessment } from "../format/parse";
import { toSaveFile } from "../format/saveFile";
import { NOTE_MAX, type Assessment } from "../format/schema";
import { fixtureAssessment } from "../report/fixture";
import { useStore } from "./store";

const kind = catalogue.aiRegister!.model.kinds[0];
const metadata = {
  createdAt: "2026-01-10",
  lastSharedWithDta: "2026-07-10",
  dateConfirmation: { by: "Jo", on: "2026-07-11" },
  futureMetadata: { revision: 2, reviewers: [{ name: "Pat", confirmed: true }] },
};
const current = () => useStore.getState().assessment;
const entries = () => current().aiRegister!.entries;

beforeEach(() => useStore.getState().reset());
afterEach(() => useStore.getState().reset());

describe("AI register metadata survives entry actions", () => {
  beforeEach(() => {
    const a = fixtureAssessment(catalogue, ["microsoft"]);
    const first = { ...newUseCase(kind, "first"), jewels: a.jewels.map((j) => j.id) };
    useStore.getState().load({
      ...a,
      aiRegister: { ...structuredClone(metadata), entries: [first, newUseCase(kind, "kept"), ...exampleEntries(a)] },
    });
  });

  const actions: { name: string; run: () => void }[] = [
    {
      name: "add a use case",
      run: () => {
        const before = entries();
        const id = useStore.getState().addAiUseCase(kind);
        expect(entries()).toEqual([...before, newUseCase(kind, id)]);
        expect(current().progress?.aiSection).toBe(id);
      },
    },
    {
      name: "update a use case",
      run: () => {
        const before = entries();
        useStore.getState().updateAiUseCase("first", { ownerName: "New owner", criteria: ["c4"] });
        expect(entries()).toEqual([{ ...before[0], ownerName: "New owner", criteria: ["c4"] }, ...before.slice(1)]);
      },
    },
    {
      name: "set an answer",
      run: () => {
        const before = entries();
        useStore.getState().setAiAnswer("first", "AIR-ACC-001", "yes");
        expect(entries()).toEqual([{ ...before[0], answers: { ...before[0].answers, "AIR-ACC-001": "yes" } }, ...before.slice(1)]);
      },
    },
    {
      name: "set a bounded note",
      run: () => {
        const before = entries();
        useStore.getState().setAiNote("first", "AIR-ACC-001", "x".repeat(NOTE_MAX + 50));
        expect(entries()).toEqual([{ ...before[0], notes: { ...before[0].notes, "AIR-ACC-001": "x".repeat(NOTE_MAX) } }, ...before.slice(1)]);
      },
    },
    {
      name: "remove a use case",
      run: () => {
        const before = entries();
        useStore.getState().removeAiUseCase("first");
        expect(entries()).toEqual(before.slice(1));
      },
    },
    {
      name: "replace examples",
      run: () => {
        const real = entries().filter((e) => !e.example);
        useStore.getState().loadAiExamples();
        expect(entries()).toEqual([...real, ...exampleEntries(current())]);
        expect(entries().filter((e) => e.example)).toHaveLength(3);
        expect(current().progress?.aiSection).toBe(entries()[real.length].id);
      },
    },
    {
      name: "remove examples",
      run: () => {
        const real = entries().filter((e) => !e.example);
        useStore.getState().removeAiExamples();
        expect(entries()).toEqual(real);
      },
    },
    {
      name: "remove a linked crown jewel",
      run: () => {
        const before = current();
        const id = before.jewels[0].id;
        useStore.getState().removeJewel(id);
        expect(current().jewels).toEqual(before.jewels.slice(1));
        expect(entries()).toEqual(before.aiRegister!.entries.map((e) => ({ ...e, jewels: e.jewels.filter((j) => j !== id) })));
      },
    },
    {
      name: "import a use case",
      run: () => {
        const before = entries();
        const imported = newUseCase(kind, "imported");
        useStore.getState().addImportedAiUseCase(imported);
        expect(entries()).toEqual([...before, imported]);
      },
    },
  ];

  it.each(actions)("$name preserves metadata in memory and after save/reopen", ({ run }) => {
    run();
    expect(current().aiRegister).toMatchObject(metadata);
    const savedRegister = structuredClone(current().aiRegister);
    const parsed = parseAssessment(JSON.parse(toSaveFile(current())));
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("Saved assessment could not be reopened");
    useStore.getState().reset();
    useStore.getState().load(parsed.assessment);
    expect(current().aiRegister).toEqual(savedRegister);
    expect(current().aiRegister).toMatchObject(metadata);
  });

  it("still deletes the whole register when explicitly excluded", () => {
    useStore.getState().setAiIncluded(false);
    expect(current().aiRegister).toBeUndefined();
  });
});

describe("entry actions with no optional register", () => {
  it("adds a use case and opens it", () => {
    const id = useStore.getState().addAiUseCase(kind);
    expect(entries()).toEqual([newUseCase(kind, id)]);
    expect(current().progress?.aiSection).toBe(id);
  });

  it("loads examples and opens the first", () => {
    useStore.getState().loadAiExamples();
    expect(entries()).toEqual(exampleEntries(emptyAssessment()));
    expect(current().progress?.aiSection).toBe(entries()[0].id);
  });

  it.each(["update", "answer", "note", "remove", "remove examples"])("%s retains empty-register behaviour", (action) => {
    const s = useStore.getState();
    if (action === "update") s.updateAiUseCase("missing", { ownerName: "Jo" });
    if (action === "answer") s.setAiAnswer("missing", "AIR-ACC-001", "yes");
    if (action === "note") s.setAiNote("missing", "AIR-ACC-001", "Checked");
    if (action === "remove") s.removeAiUseCase("missing");
    if (action === "remove examples") s.removeAiExamples();
    expect(current().aiRegister).toEqual({ entries: [] });
  });

  it("removes a crown jewel without creating a register", () => {
    const a: Assessment = { ...fixtureAssessment(catalogue, ["microsoft"]), aiRegister: undefined };
    useStore.getState().load(a);
    useStore.getState().removeJewel(a.jewels[0].id);
    expect(current().jewels).toEqual(a.jewels.slice(1));
    expect(current().aiRegister).toBeUndefined();
  });
});

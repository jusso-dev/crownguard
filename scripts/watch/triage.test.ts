import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Question, Source } from "../../src/content/schema";
import { TRIAGE_MODEL, triageChanges, type TriageInput } from "./triage";

const source: Source = { id: "ms-ca-plan", title: "Plan a Conditional Access deployment", publisher: "Microsoft", url: "https://learn.microsoft.com/x", retrieved: "2026-01-01" };
const question = {
  id: "MS-ID-001",
  question: "Is MFA required for all users?",
  yesLooksLike: "A Conditional Access policy requires MFA for all users.",
  remediation: "Create a Conditional Access policy requiring MFA.",
  licence: ["entra-p1"],
} as Question;

const input = (id = "ms-ca-plan"): TriageInput => ({
  finding: { kind: "changed", sourceId: id, title: source.title, url: source.url, severity: "major", actionable: true, detail: "2 sections added", citedBy: ["MS-ID-001"] },
  source: { ...source, id },
  questions: [question],
  diffText: "- old\n+ new",
});

type CreateArgs = Parameters<Anthropic["beta"]["messages"]["create"]>[0];

function fakeClient(reply: (args: CreateArgs) => unknown) {
  const calls: CreateArgs[] = [];
  const client = {
    beta: {
      messages: {
        create: async (args: CreateArgs) => {
          calls.push(args);
          return reply(args);
        },
      },
    },
  } as unknown as Pick<Anthropic, "beta">;
  return { client, calls };
}

const answer = (impact = "review") =>
  JSON.stringify({ impact, summary: "The page added a rollout section.", questions: [{ id: "MS-ID-001", note: "Mention report-only mode." }, { id: "MS-XX-999", note: "not ours" }] });

const ok = (impact = "review", stop = "end_turn", text = answer(impact)) => ({
  stop_reason: stop,
  model: TRIAGE_MODEL,
  usage: { input_tokens: 900, output_tokens: 120 },
  content: [{ type: "text", text }],
});

describe("triageChanges", () => {
  it("does nothing without an API key", async () => {
    const run = await triageChanges([input()], {});
    expect(run.calls).toBe(0);
    expect(run.results.size).toBe(0);
  });

  it("asks Claude with fallbacks and structured output, and keeps only known question ids", async () => {
    const { client, calls } = fakeClient(() => ok());
    const run = await triageChanges([input()], { client });
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].fallbacks).toBe("default");
    expect(calls[0].betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(calls[0].output_config?.effort).toBe("medium");
    expect(JSON.stringify(calls[0].messages)).toContain("MS-ID-001: Is MFA required for all users?");
    const t = run.results.get("ms-ca-plan");
    expect(t?.impact).toBe("review");
    expect(t?.questions).toEqual([{ id: "MS-ID-001", note: "Mention report-only mode." }]);
  });

  it("caps calls per run and says what it skipped", async () => {
    const { client, calls } = fakeClient(() => ok("none"));
    const run = await triageChanges([input("a"), input("b"), input("c")], { client, max: 2 });
    expect(calls).toHaveLength(2);
    expect(run.skipped[0]).toMatch(/1 of 3 changed pages not triaged/);
  });

  it("handles refusals and stops on authentication errors", async () => {
    const refused = fakeClient(() => ({ ...ok("review", "refusal", ""), stop_details: { category: "cyber" } }));
    const r1 = await triageChanges([input()], { client: refused.client });
    expect(r1.results.size).toBe(0);
    expect(r1.skipped[0]).toMatch(/declined ms-ca-plan \(cyber\)/);

    const denied = fakeClient(() => {
      throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers());
    });
    const r2 = await triageChanges([input("a"), input("b")], { client: denied.client });
    expect(denied.calls).toHaveLength(1);
    expect(r2.skipped[0]).toMatch(/disabled/);
  });

  it("treats a cut-off answer as unusable instead of failing", async () => {
    const cut = fakeClient(() => ok("review", "max_tokens", '{"impact":"rev'));
    const r = await triageChanges([input()], { client: cut.client });
    expect(r.results.size).toBe(0);
    expect(r.skipped[0]).toMatch(/no usable answer for ms-ca-plan \(max_tokens\)/);
  });

  it("stops starting requests when the time budget runs out", async () => {
    let t = 0;
    const slow = fakeClient(() => {
      t += 6 * 60_000;
      return ok();
    });
    const r = await triageChanges([input("a"), input("b"), input("c")], { client: slow.client, now: () => t });
    expect(slow.calls).toHaveLength(2);
    expect(r.skipped.at(-1)).toMatch(/1 changed pages not triaged \(time budget used up\)/);
  });
});

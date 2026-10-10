import { useRef, useState } from "react";
import { catalogue } from "../../content/catalogue";
import { useEnsurePlatforms } from "../../content/useCatalogue";
import { exposures, tiers, type AssetType, type Tier } from "../../content/schema";
import { suggestDsl } from "../../engine/idcf";
import { impactOf } from "../../engine/risk";
import {
  classifications,
  dsls,
  regulations,
  type Classification,
  type CrownJewel,
  type Dsl,
  type ImpactRating,
  type Regulation,
} from "../../engine/types";
import { useStore } from "../store";
import { Button, Card, CheckboxPill, Field, FieldGroup, inputClass, StepHeader } from "../ui";

export const tierLabels: Record<Tier, string> = {
  identity: "Identity plane",
  privileged: "Privileged access",
  data: "Business data",
  collaboration: "Collaboration & email",
  endpoint: "Endpoints",
  cloud: "Cloud infrastructure",
  ai: "AI assistants",
};

const impactLabels = ["Minimal", "Minor", "Moderate", "Major", "Severe"];

/** IDCF guidance per level, paraphrased from the framework's examples at a moderate risk appetite. */
const dslHelp: Record<Dsl | "none", string> = {
  none: "DSL-2 suits everyday business data such as email and internal policy. DSL-3 suits Privacy Act personal and sensitive information, confidential IP and personnel files. DSL-4 suits nationally important or highly confidential core data. A lower risk appetite means a higher level.",
  "dsl-0": "DSL-0 isn't permission to publish, and crown jewels are rarely DSL-0: their integrity and availability usually need DSL-2 or higher.",
  "dsl-1": "DSL-1 covers physical protection only and is generally not suitable for day-to-day business.",
  "dsl-2": "DSL-2: protection against opportunistic attacks, with cyber controls equivalent to Essential Eight Maturity Level 1. Everyday business data such as email and internal policy.",
  "dsl-3": "DSL-3: the standard for sensitive information, with cyber controls equivalent to Essential Eight Maturity Level 2. Privacy Act personal and sensitive information, confidential IP, personnel files. Strong parallels with OFFICIAL: Sensitive.",
  "dsl-4": "DSL-4: highly desirable to adversaries, with cyber controls equivalent to Essential Eight Maturity Level 3, usually in a separate specialised environment. Strong parallels with PROTECTED.",
  "dsl-5-plus": "DSL-5+: protection is agreed between the parties. The IDCF gives no guidance, and it is beyond this self-assessment.",
};

export function JewelsStep() {
  const { assessment } = useStore();
  const ready = useEnsurePlatforms(assessment.platforms);
  if (!ready) {
    return (
      <StepHeader title="Identify your crown jewels">
        Loading platform asset types…
      </StepHeader>
    );
  }
  return (
    <>
      <StepHeader title="Identify your crown jewels">
        Work through each category below. Read the prompts, then add the specific things that matter most: a named
        SharePoint site, the executive mailboxes, your Global Administrators. Rate what would happen if each were
        exposed (confidentiality), tampered with (integrity) or unavailable (availability).
      </StepHeader>
      {assessment.platforms.map((pid) => {
        const bundle = catalogue.platforms.get(pid);
        if (!bundle) return null;
        const enabled = (a: AssetType) =>
          !bundle.platform.modules.find((m) => m.id === a.module)?.optional || assessment.modules[pid]?.includes(a.module);
        const types = bundle.assetTypes.filter(enabled);
        return (
          <section key={pid} className="mb-12">
            <h2 className="mb-6 text-[1.375rem] font-semibold leading-tight">{bundle.platform.name}</h2>
            {tiers
              .filter((t) => types.some((a) => a.tier === t))
              .map((tier) => (
                <div key={tier} className="mb-8">
                  <h3 className="mono-label mb-3 font-mono text-muted">{tierLabels[tier]}</h3>
                  <div className="space-y-2.5">
                    {types
                      .filter((a) => a.tier === tier)
                      .map((a) => (
                        <AssetCard key={a.id} platform={pid} asset={a} />
                      ))}
                  </div>
                </div>
              ))}
          </section>
        );
      })}
    </>
  );
}

function AssetCard({ platform, asset }: { platform: string; asset: AssetType }) {
  const { assessment, removeJewel } = useStore();
  const [editing, setEditing] = useState<CrownJewel | null>(null);
  const jewels = assessment.jewels.filter((j) => j.assetType === asset.id);

  const blank = (): CrownJewel => ({
    id: crypto.randomUUID(),
    name: jewels.length ? "" : asset.name,
    platform,
    assetType: asset.id,
    description: "",
    classification: "confidential",
    confidentiality: 4,
    integrity: 4,
    availability: 3,
    regulations: [...assessment.org.regulations],
    exposures: [],
    businessProcesses: "",
  });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-semibold leading-snug">{asset.name}</h4>
          <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-ink-2">{asset.description}</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(blank())} aria-label={`Add crown jewel: ${asset.name}`}>
          + Add
        </Button>
      </div>
      <details className="mt-3 text-sm">
        <summary className="text-muted transition-colors [@media(hover:hover)]:hover:text-ink">Questions to help you decide</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-ink-2 marker:text-rule-2">
          {asset.discoveryPrompts.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <p className="mt-3 text-xs text-muted"><span className="mono-label mr-2">Examples</span>{asset.examples.join(" · ")}</p>
      </details>

      {jewels.length > 0 && (
        <ul className="mt-4 divide-y divide-rule overflow-hidden rounded-[var(--radius-control)] border border-rule bg-paper">
          {jewels.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="font-medium text-ink">{j.name}</span>
              <span className="text-muted">
                Impact {impactOf(j)}/5 · {classifications[j.classification]}
                {j.dsl ? ` · ${dsls[j.dsl]}` : ""}
              </span>
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" onClick={() => setEditing(j)}>Edit</Button>
                <Button variant="ghost" onClick={() => removeJewel(j.id)}>Remove</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <JewelForm asset={asset} initial={editing} onDone={() => setEditing(null)} />}
    </Card>
  );
}

function JewelForm({ asset, initial, onDone }: { asset: AssetType; initial: CrownJewel; onDone: () => void }) {
  const upsertJewel = useStore((s) => s.upsertJewel);
  const [j, setJ] = useState(initial);
  const set = (patch: Partial<CrownJewel>) => setJ((x) => ({ ...x, ...patch }));
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));

  return (
    <form
      className="mt-4 space-y-6 rounded-[var(--radius-control)] border border-rule-2 bg-paper p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        upsertJewel({ ...j, name: j.name.trim() || asset.name });
        onDone();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input className={inputClass} value={j.name} onChange={(e) => set({ name: e.target.value })} placeholder={asset.examples[0]} autoFocus />
        </Field>
        <Field label="Classification">
          <select className={inputClass} value={j.classification} onChange={(e) => set({ classification: e.target.value as Classification })}>
            {(Object.keys(classifications) as Classification[]).map((c) => (
              <option key={c} value={c}>{classifications[c]}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="What is it and why does it matter?">
            <textarea className={inputClass} rows={2} value={j.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["confidentiality", "integrity", "availability"] as const).map((k) => (
          <fieldset key={k}>
            <legend className="text-sm font-medium capitalize text-ink">{k} impact</legend>
            <div className="mt-1.5 flex overflow-hidden rounded-[var(--radius-control)] border border-field bg-surface" role="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={j[k] === n}
                  aria-label={`${k} ${n} ${impactLabels[n - 1]}`}
                  title={impactLabels[n - 1]}
                  onClick={() => set({ [k]: n as ImpactRating })}
                  className={`h-9 flex-1 font-mono text-sm tabular-nums transition-colors duration-150 focus-visible:-outline-offset-2 ${n > 1 ? "border-l border-rule-2" : ""} ${j[k] === n ? "bg-ink font-medium text-paper" : "text-ink-2 [@media(hover:hover)]:hover:bg-sunken"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-xs text-muted">{impactLabels[j[k] - 1]}</div>
          </fieldset>
        ))}
      </div>

      <FieldGroup label="Exposure" hint="Tick everything that's true today. Each one raises likelihood.">
        <div className="flex flex-wrap gap-2">
          {asset.exposures.map((x) => (
            <CheckboxPill key={x} checked={j.exposures.includes(x)} onChange={(on) => set({ exposures: toggle(j.exposures, x, on) })}>
              {exposures[x]}
            </CheckboxPill>
          ))}
        </div>
      </FieldGroup>

      <FieldGroup label="Obligations covering this data">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(regulations) as Regulation[]).map((r) => (
            <CheckboxPill key={r} checked={j.regulations.includes(r)} onChange={(on) => set({ regulations: toggle(j.regulations, r, on) })}>
              {regulations[r]}
            </CheckboxPill>
          ))}
        </div>
      </FieldGroup>

      <DslField jewel={j} onChange={(dsl) => set({ dsl })} />

      <Field label="Business processes that depend on it" hint="Optional. Appears in the crown-jewel register.">
        <input className={inputClass} value={j.businessProcesses} onChange={(e) => set({ businessProcesses: e.target.value })} placeholder="e.g. Payroll, client billing" />
      </Field>

      <div className="flex gap-2">
        <Button type="submit">Save crown jewel</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/** Optional IDCF Data Security Level. Never filled in automatically: the data owner chooses it. */
function DslField({ jewel, onChange }: { jewel: CrownJewel; onChange: (dsl: Dsl | undefined) => void }) {
  const suggested = suggestDsl(jewel);
  const select = useRef<HTMLSelectElement>(null);
  return (
    <FieldGroup
      label="IDCF Data Security Level (optional)"
      hint="Only if your organisation uses the Home Affairs Industry Data Classification Framework. The report then lists the gaps the questions found against that level; it can't confirm the level is met."
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          ref={select}
          aria-label="IDCF Data Security Level"
          className={`${inputClass} sm:max-w-48`}
          value={jewel.dsl ?? ""}
          onChange={(e) => onChange((e.target.value || undefined) as Dsl | undefined)}
        >
          <option value="">Not classified</option>
          {(Object.keys(dsls) as Dsl[]).map((d) => (
            <option key={d} value={d}>
              {dsls[d]}
            </option>
          ))}
        </select>
        {jewel.dsl !== suggested && (
          <Button
            variant="secondary"
            onClick={() => {
              onChange(suggested);
              // The button goes away once the suggestion is applied: keep focus on the field it changed.
              select.current?.focus();
            }}
          >
            Use crownguard&apos;s suggestion: {dsls[suggested]}
          </Button>
        )}
      </div>
      <p className="mt-1.5 max-w-[72ch] text-xs text-muted" aria-live="polite">
        {dslHelp[jewel.dsl ?? "none"]}
      </p>
    </FieldGroup>
  );
}

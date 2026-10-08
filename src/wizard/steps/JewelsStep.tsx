import { useState } from "react";
import { catalogue } from "../../content/catalogue";
import { exposures, tiers, type AssetType, type Tier } from "../../content/schema";
import { impactOf } from "../../engine/risk";
import {
  classifications,
  regulations,
  type Classification,
  type CrownJewel,
  type ImpactRating,
  type Regulation,
} from "../../engine/types";
import { useStore } from "../store";
import { Button, Card, CheckboxPill, Field, inputClass, StepHeader } from "../ui";

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

export function JewelsStep() {
  const { assessment } = useStore();
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
          <section key={pid} className="mb-10">
            <h2 className="mb-4 text-lg font-semibold">{bundle.platform.name}</h2>
            {tiers
              .filter((t) => types.some((a) => a.tier === t))
              .map((tier) => (
                <div key={tier} className="mb-6">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gold">{tierLabels[tier]}</h3>
                  <div className="space-y-3">
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
          <h4 className="font-semibold">{asset.name}</h4>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">{asset.description}</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(blank())} aria-label={`Add crown jewel: ${asset.name}`}>
          + Add
        </Button>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-soft hover:text-ink">Questions to help you decide</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-soft">
          {asset.discoveryPrompts.map((p) => <li key={p}>{p}</li>)}
        </ul>
        <p className="mt-2 text-xs text-ink-soft">Examples: {asset.examples.join(" · ")}</p>
      </details>

      {jewels.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {jewels.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
              <span className="font-medium">{j.name}</span>
              <span className="text-ink-soft">
                Impact {impactOf(j)}/5 · {classifications[j.classification]}
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
      className="mt-4 space-y-5 rounded-lg border border-gold/40 bg-gold-soft/40 p-4"
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
            <legend className="text-sm font-medium capitalize">{k} impact</legend>
            <div className="mt-1.5 flex gap-1" role="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={j[k] === n}
                  aria-label={`${k} ${n} ${impactLabels[n - 1]}`}
                  title={impactLabels[n - 1]}
                  onClick={() => set({ [k]: n as ImpactRating })}
                  className={`h-8 flex-1 rounded text-sm font-medium ${j[k] === n ? "bg-ink text-white" : "border border-line bg-white"}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-1 text-xs text-ink-soft">{impactLabels[j[k] - 1]}</div>
          </fieldset>
        ))}
      </div>

      <Field label="Exposure" hint="Tick everything that's true today. Each one raises likelihood.">
        <div className="flex flex-wrap gap-2">
          {asset.exposures.map((x) => (
            <CheckboxPill key={x} checked={j.exposures.includes(x)} onChange={(on) => set({ exposures: toggle(j.exposures, x, on) })}>
              {exposures[x]}
            </CheckboxPill>
          ))}
        </div>
      </Field>

      <Field label="Obligations covering this data">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(regulations) as Regulation[]).map((r) => (
            <CheckboxPill key={r} checked={j.regulations.includes(r)} onChange={(on) => set({ regulations: toggle(j.regulations, r, on) })}>
              {regulations[r]}
            </CheckboxPill>
          ))}
        </div>
      </Field>

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

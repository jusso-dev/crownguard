import { useState } from "react";
import { abnDigits, formatAbn, isValidAbn } from "../../engine/abn";
import { regulations, type Regulation } from "../../engine/types";
import { LogoField } from "../LogoField";
import { requestOpenFile } from "../download";
import { useStore } from "../store";
import { Button, CheckboxPill, Field, FieldGroup, inputClass, StepHeader } from "../ui";

const sectors = [
  "Government", "Health", "Education", "Financial services", "Critical infrastructure", "Legal & professional services",
  "Not-for-profit / community", "Retail & hospitality", "Technology", "Manufacturing", "Other",
];
const sizes = ["1–19 staff", "20–199 staff", "200–999 staff", "1,000–4,999 staff", "5,000+ staff"];

export function OrgStep() {
  const { assessment, setOrg } = useStore();
  const org = assessment.org;
  const [abnTouched, setAbnTouched] = useState(false);
  const abnError = abnTouched && !!org.abn && !isValidAbn(org.abn);
  const toggle = (r: Regulation, on: boolean) =>
    setOrg({ regulations: on ? [...org.regulations, r] : org.regulations.filter((x) => x !== r) });

  return (
    <>
      <StepHeader title="Your organisation">
        Crown jewels are the systems and information whose loss, exposure or corruption would seriously hurt your
        organisation. This assessment helps you name them, check how well your Microsoft or Google environment protects
        them, and produce a report you can take to leadership. Nothing you enter leaves this browser.
      </StepHeader>
      <div className="mb-8 flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-control)] border border-rule bg-surface px-4 py-3 text-sm">
        <span className="text-ink-2">
          Updating an earlier assessment? Open its saved <span className="font-mono text-xs">.crownguard.json</span> file, add your logo or ABN, then regenerate the report.
        </span>
        <Button variant="secondary" className="sm:ml-auto" onClick={requestOpenFile}>
          Open saved file
        </Button>
      </div>
      <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Organisation name">
            <input className={inputClass} value={org.name} onChange={(e) => setOrg({ name: e.target.value })} placeholder="e.g. Riverbend Health" />
          </Field>
        </div>
        <div>
          <label htmlFor="org-abn" className="text-sm font-medium text-ink">
            ABN <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="org-abn"
            inputMode="numeric"
            autoComplete="off"
            className={`${inputClass} mt-1.5 font-mono tabular-nums ${abnError ? "border-danger!" : ""}`}
            placeholder="51 824 753 556"
            value={formatAbn(org.abn ?? "")}
            aria-invalid={abnError || undefined}
            aria-describedby="org-abn-help"
            onChange={(e) => setOrg({ abn: abnDigits(e.target.value) })}
            onBlur={() => setAbnTouched(true)}
          />
          <p id="org-abn-help" className={`mt-1 text-xs ${abnError ? "text-danger" : "text-muted"}`}>
            {abnError ? "That ABN fails the ATO check-digit test. Check for a typo." : "Printed on the report cover."}
          </p>
        </div>
        <Field label="Primary jurisdiction">
          <input className={inputClass} value={org.jurisdiction} onChange={(e) => setOrg({ jurisdiction: e.target.value })} />
        </Field>
        <Field label="Sector">
          <select className={inputClass} value={org.sector} onChange={(e) => setOrg({ sector: e.target.value })}>
            <option value="">Select…</option>
            {sectors.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Size">
          <select className={inputClass} value={org.size} onChange={(e) => setOrg({ size: e.target.value })}>
            <option value="">Select…</option>
            {sizes.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <LogoField testId="org-logo-input" />
        </div>
        <div className="sm:col-span-2">
          <FieldGroup label="Obligations that apply to your organisation" hint="Used to frame impact. You can refine per crown jewel later.">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(regulations) as Regulation[]).map((r) => (
                <CheckboxPill key={r} checked={org.regulations.includes(r)} onChange={(on) => toggle(r, on)}>
                  {regulations[r]}
                </CheckboxPill>
              ))}
            </div>
          </FieldGroup>
        </div>
      </div>
    </>
  );
}

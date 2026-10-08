import { regulations, type Regulation } from "../../engine/types";
import { useStore } from "../store";
import { CheckboxPill, Field, inputClass, StepHeader } from "../ui";

const sectors = [
  "Government", "Health", "Education", "Financial services", "Critical infrastructure", "Legal & professional services",
  "Not-for-profit / community", "Retail & hospitality", "Technology", "Manufacturing", "Other",
];
const sizes = ["1–19 staff", "20–199 staff", "200–999 staff", "1,000–4,999 staff", "5,000+ staff"];

export function OrgStep() {
  const { assessment, setOrg } = useStore();
  const org = assessment.org;
  const toggle = (r: Regulation, on: boolean) =>
    setOrg({ regulations: on ? [...org.regulations, r] : org.regulations.filter((x) => x !== r) });

  return (
    <>
      <StepHeader title="Your organisation">
        Crown jewels are the systems and information whose loss, exposure or corruption would seriously hurt your
        organisation. This assessment helps you name them, check how well your Microsoft or Google environment protects
        them, and produce a report you can take to leadership. Nothing you enter leaves this browser.
      </StepHeader>
      <div className="grid max-w-3xl gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Organisation name">
            <input className={inputClass} value={org.name} onChange={(e) => setOrg({ name: e.target.value })} placeholder="e.g. Riverbend Health" />
          </Field>
        </div>
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
        <Field label="Primary jurisdiction">
          <input className={inputClass} value={org.jurisdiction} onChange={(e) => setOrg({ jurisdiction: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Obligations that apply to your organisation" hint="Used to frame impact. You can refine per crown jewel later.">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(regulations) as Regulation[]).map((r) => (
                <CheckboxPill key={r} checked={org.regulations.includes(r)} onChange={(on) => toggle(r, on)}>
                  {regulations[r]}
                </CheckboxPill>
              ))}
            </div>
          </Field>
        </div>
      </div>
    </>
  );
}

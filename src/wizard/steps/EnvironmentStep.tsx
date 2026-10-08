import { catalogue } from "../../content/catalogue";
import { useStore } from "../store";
import { Card, Field, inputClass, StepHeader } from "../ui";

export function EnvironmentStep() {
  const { assessment, update } = useStore();
  const bundles = [...catalogue.platforms.values()];

  const togglePlatform = (id: string, on: boolean) =>
    update((a) => ({
      platforms: on ? [...a.platforms, id] : a.platforms.filter((p) => p !== id),
      licence: on && !a.licence[id] ? { ...a.licence, [id]: catalogue.platforms.get(id)!.platform.licenceTiers[0].id } : a.licence,
    }));
  const toggleModule = (pid: string, mid: string, on: boolean) =>
    update((a) => {
      const current = a.modules[pid] ?? [];
      return { modules: { ...a.modules, [pid]: on ? [...current, mid] : current.filter((m) => m !== mid) } };
    });

  return (
    <>
      <StepHeader title="Your environment">
        Choose the platforms your organisation runs on. Pick both if you have a mixed estate. Your licence tier tells
        the report which fixes you already own and which need an upgrade.
      </StepHeader>
      <div className="grid gap-4 md:grid-cols-2">
        {bundles.map(({ platform }) => {
          const on = assessment.platforms.includes(platform.id);
          return (
            <Card key={platform.id} className={`transition-colors duration-150 ${on ? "border-ink!" : "[@media(hover:hover)]:hover:border-rule-2!"}`}>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                  checked={on}
                  onChange={(e) => togglePlatform(platform.id, e.target.checked)}
                />
                <span>
                  <span className="block font-display text-base font-semibold tracking-[-0.01em] text-ink">{platform.name}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted">{platform.description}</span>
                </span>
              </label>
              {on && (
                <div className="mt-5 space-y-4 border-t border-rule pt-4">
                  <Field label="Licence tier">
                    <select
                      className={inputClass}
                      value={assessment.licence[platform.id] ?? ""}
                      onChange={(e) => update((a) => ({ licence: { ...a.licence, [platform.id]: e.target.value } }))}
                    >
                      {platform.licenceTiers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {platform.modules
                    .filter((m) => m.optional)
                    .map((m) => (
                      <label key={m.id} className="flex cursor-pointer items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                          checked={assessment.modules[platform.id]?.includes(m.id) ?? false}
                          onChange={(e) => toggleModule(platform.id, m.id, e.target.checked)}
                        />
                        <span>
                          <span className="font-medium">Include {m.name}</span>
                          <span className="block text-muted">{m.description}</span>
                        </span>
                      </label>
                    ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

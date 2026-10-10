import type { Catalogue } from "./schema";

/** Every source the AI register's model, questions, curated AI app list and scope table cite. */
export const aiRegisterSources = ({ model, questions, knownApps, scopes }: NonNullable<Catalogue["aiRegister"]>) => [
  ...model.sources,
  ...model.dates.map((d) => d.source),
  ...model.caveats.flatMap((c) => c.sources),
  ...model.kinds.flatMap((k) => k.sources),
  ...questions.flatMap((q) => q.sources),
  ...knownApps.map((a) => a.source),
  ...scopes.map((s) => s.source),
];

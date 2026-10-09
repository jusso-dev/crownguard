import type { Question } from "../content/schema";
import { addsNothing, type E8Result } from "./maturity";
import type { Answer, CrownJewel, Dsl } from "./types";

/** The IDCF levels a cloud configuration review can say something about. */
export const IDCF_LEVELS = [2, 3, 4] as const;
export type IdcfLevel = (typeof IDCF_LEVELS)[number];

export interface IdcfCell {
  /** "gaps": a mapped question isn't answered Yes; "clear": none found in what was asked; "not-verified": the
   * assessment can't tell (e.g. an Essential Eight level it doesn't ask); "not-assessed": nothing maps here. */
  status: "gaps" | "clear" | "not-verified" | "not-assessed";
  gaps: Question[];
  notVerified: string[];
}

export interface IdcfRow {
  level: IdcfLevel;
  physical: IdcfCell;
  cyber: IdcfCell;
  person: IdcfCell;
}

const satisfied = (a: Answer | undefined) => a === "yes" || a === "na";

/** Questions mapped to any of these IDCF refs, and which of them aren't answered Yes. */
function mappedCell(questions: Question[], answers: Record<string, Answer>, refs: string[]): IdcfCell {
  const mapped = questions.filter((q) => q.refs.some((r) => r.framework === "idcf" && refs.includes(r.ref)));
  if (!mapped.length) return { status: "not-assessed", gaps: [], notVerified: [] };
  const gaps = mapped.filter((q) => !satisfied(answers[q.id]));
  return { status: gaps.length ? "gaps" : "clear", gaps, notVerified: [] };
}

const partName = { Physical: "device", "Authorised person": "authorised-person" } as const;

/**
 * Questions mapped to a DSL row of this kind at or below `level`. When none maps to the level's own row, that level's
 * own requirements weren't asked, so the cell can't be clear.
 */
function refCell(questions: Question[], answers: Record<string, Answer>, level: IdcfLevel, kind: "Physical" | "Authorised person"): IdcfCell {
  const cell = mappedCell(questions, answers, IDCF_LEVELS.filter((l) => l <= level).map((l) => `DSL-${l} ${kind}`));
  if (cell.status === "not-assessed") return cell;
  const own = questions.some((q) => q.refs.some((r) => r.framework === "idcf" && r.ref === `DSL-${level} ${kind}`));
  return own ? cell : { ...cell, status: cell.gaps.length ? "gaps" : "not-verified", notVerified: [`DSL-${level} ${partName[kind]} requirements not asked`] };
}

/** Whole-system and data-movement questions (IDCF 4.9). They apply at every level from DSL-2. */
export function systemCell(questions: Question[], answers: Record<string, Answer>): IdcfCell {
  return mappedCell(questions, answers, ["Whole system", "Movement"]);
}

/**
 * The IDCF treats systems at Essential Eight Maturity Level 1, 2 or 3 as meeting the cyber part of DSL-2, 3 or 4, so
 * the cyber cell is read from the indicative Essential Eight results for the platform's questions: every open question
 * a strategy has up to the required level, and the first required level it has no questions for.
 */
function cyberCell(questions: Question[], answers: Record<string, Answer>, e8: (E8Result & { title: string })[], level: IdcfLevel): IdcfCell {
  const required = level - 1;
  const gaps = new Map<string, Question>();
  const notVerified: string[] = [];
  for (const r of e8) {
    if (r.level === null) {
      notVerified.push(`${r.title} (not covered by this assessment)`);
      continue;
    }
    if (r.level >= required) continue;
    const tagged = (l: number) => questions.filter((q) => q.e8.some((t) => t.strategy === r.strategy && t.level === l));
    for (let l = 1; l <= required; l++) for (const q of tagged(l)) if (!satisfied(answers[q.id])) gaps.set(q.id, q);
    const missing = [1, 2, 3].find((l) => l <= required && tagged(l).length === 0 && !addsNothing(r.strategy, l));
    if (missing) notVerified.push(`${r.title} (Maturity Level ${missing} not asked)`);
  }
  const g = [...gaps.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { status: g.length ? "gaps" : notVerified.length ? "not-verified" : "clear", gaps: g, notVerified };
}

/**
 * The DSL-2 to DSL-4 rows. Physical and authorised-person cells come from `questions`; the cyber cell from the
 * Essential Eight results, whose open questions are listed from `e8Questions` (the whole platform by default, since
 * Essential Eight maturity is tenant-wide).
 */
export function idcfRows(questions: Question[], answers: Record<string, Answer>, e8: (E8Result & { title: string })[], e8Questions: Question[] = questions): IdcfRow[] {
  return IDCF_LEVELS.map((level) => ({
    level,
    physical: refCell(questions, answers, level, "Physical"),
    cyber: cyberCell(e8Questions, answers, e8, level),
    person: refCell(questions, answers, level, "Authorised person"),
  }));
}

const and = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** "Not verified" items with their reasons grouped: "A, B and C (not covered by this assessment); D (...)". */
export function notVerifiedText(items: string[]): string {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const m = item.match(/^(.*) \(([^()]+)\)$/);
    const [name, why] = m ? [m[1], m[2]] : [item, ""];
    groups.set(why, [...(groups.get(why) ?? []), name]);
  }
  return [...groups].map(([why, names]) => (why ? `${and(names)} (${why})` : names.join("; "))).join("; ");
}

export const dslLevel = (dsl: Dsl): number | "5+" => (dsl === "dsl-5-plus" ? "5+" : Number(dsl.slice(4)));

export interface JewelDsl {
  jewel: CrownJewel;
  /** Plain-language Rule 2 result for the report. */
  text: string;
  gaps: Question[];
}

/**
 * IDCF Rule 2: data labelled with a DSL is stored only in systems that protect it at or above that level. `rows` and
 * `system` should be built from the questions that apply to this crown jewel, so gaps elsewhere on the platform aren't
 * attributed to it.
 */
export function jewelDsl(jewel: CrownJewel, rows: IdcfRow[], system?: IdcfCell): JewelDsl | undefined {
  if (!jewel.dsl) return undefined;
  const level = dslLevel(jewel.dsl);
  const label = level === "5+" ? "DSL-5+" : `DSL-${level}`;
  if (level === "5+") return { jewel, gaps: [], text: `${jewel.name} is labelled DSL-5+. Its protection is agreed between the parties and is outside the scope of this assessment.` };
  if (level < 2) return { jewel, gaps: [], text: `${jewel.name} is labelled ${label}. No cloud configuration controls are required at ${label}; physical controls are not assessed.` };
  const within = rows.filter((r) => r.level <= level);
  const gaps = new Map<string, Question>();
  const notVerified = new Set<string>();
  for (const c of [...within.flatMap((r) => [r.physical, r.cyber, r.person]), ...(system ? [system] : [])]) {
    for (const q of c.gaps) gaps.set(q.id, q);
    for (const n of c.notVerified) notVerified.add(n);
  }
  const g = [...gaps.values()].sort((a, b) => a.id.localeCompare(b.id));
  const notAssessed = [
    within.every((r) => r.physical.status === "not-assessed") ? "device protection" : "",
    within.every((r) => r.person.status === "not-assessed") ? "authorised-person controls" : "",
    system?.status === "not-assessed" ? "whole-system and data-movement controls" : "",
  ].filter(Boolean);
  const text = [
    `${jewel.name} is labelled ${label}.`,
    `Under IDCF Rule 2, ${label} data should be stored only in systems that protect it at or above that level.`,
    g.length
      ? `This assessment found ${g.length} gap${g.length === 1 ? "" : "s"} at or below ${label}: ${g.map((q) => q.id).join(", ")}.`
      : `The questions mapped to ${label} and below found no gaps.`,
    notVerified.size ? `Not verified: ${notVerifiedText([...notVerified])}.` : "",
    notAssessed.length ? `Not assessed for this crown jewel: ${and(notAssessed)}.` : "",
    jewel.exposures?.includes("unmanaged-devices")
      ? "It is recorded as reachable from unmanaged or personal devices; under the IDCF, devices that hold or sync the data are part of the system and need the same protection."
      : "",
    `Premises security, personnel vetting and training${level === 4 ? ", and the data residency and jurisdiction controls DSL-4 needs," : ""} are not assessed.`,
  ];
  return { jewel, gaps: g, text: text.filter(Boolean).join(" ") };
}

/** crownguard's suggested DSL for a crown jewel (a heuristic, not an IDCF table: the IDCF has none). */
export function suggestDsl(j: Pick<CrownJewel, "classification" | "confidentiality" | "integrity" | "availability" | "regulations">): Dsl {
  const impact = Math.max(j.confidentiality, j.integrity, j.availability);
  let level = impact >= 5 ? 4 : impact >= 3 ? 3 : 2;
  const floor = { public: 0, internal: 2, confidential: 3, "highly-confidential": 4 }[j.classification];
  level = Math.max(level, floor);
  if (j.regulations.some((r) => r === "privacy-act" || r === "gdpr" || r === "hipaa")) level = Math.max(level, 3);
  if (j.regulations.includes("soci")) level = Math.max(level, 4);
  return `dsl-${level}` as Dsl;
}

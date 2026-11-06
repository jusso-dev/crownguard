import { RISK_SCALE } from "../engine/risk";
import { answerLabels, type Answer } from "../format/vocab";

/** "a, b and c", the en-AU way (no serial comma). */
export const andList = (items: string[]) => new Intl.ListFormat("en-AU", { type: "conjunction" }).format(items);

export const firstSentence = (t: string) => t.split(/(?<=\.)\s/)[0];

export const sentence = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);

export const answerText = (a: Answer | undefined) => (a ? answerLabels[a] : "Unanswered");

/** "12/25": a risk score out of the highest possible. */
export const riskScore = (score: number) => `${score}/${RISK_SCALE * RISK_SCALE}`;

/** Full timestamp with time zone, e.g. "8 October 2026 at 5:42 pm AEDT". */
export const stampText = (d: Date) =>
  d.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

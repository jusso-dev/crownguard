import { Link, Text, View } from "@react-pdf/renderer";
import { exposures } from "../content/schema";
import { bandOf, bands, RISK_SCALE } from "../engine/risk";
import { phases, type RoadmapItem } from "../engine/roadmap";
import { classifications, dsls, regulations } from "../format/vocab";
import type { Evidence } from "../format/schema";
import { Bullets, ReportShell, Section } from "./layout";
import { methodParagraphs } from "./method";
import type { AiRegisterReportModel, Finding, ReportModel } from "./model";
import { pct } from "../engine/percent";
import { Badge, bandColors, caution, good, line, Meter, muted, severityColors, SourceList, StatTiles, Table, useTheme } from "./primitives";
import { AiRegisterSection } from "./sections/AiRegister";
import { EssentialsSection } from "./sections/Essentials";
import { IdcfSection } from "./sections/Idcf";
import { SocSection } from "./sections/Soc";
import { firstSentence, riskScore, stampText } from "./text";
import { andList, answerText } from "../format/vocab";

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const protects = (jewels: { name: string }[]) =>
  jewels.length === 0
    ? "no recorded crown jewel (none is on this platform)"
    : jewels.length <= 3
      ? jewels.map((j) => j.name).join(", ")
      : `${jewels.slice(0, 2).map((j) => j.name).join(", ")} and ${jewels.length - 2} more`;

/**
 * Register rows don't split across pages, so a long "Supports" entry (up to 2,000 characters) would be cut off at the
 * page foot. Past this length the cell gets a shortened version and the full text is printed below the table.
 */
const SUPPORTS_CELL_MAX = 160;
const supportsInFull = (t: string) => Array.from(t).length > SUPPORTS_CELL_MAX;
const supportsCell = (t: string) => {
  if (!supportsInFull(t)) return t;
  const cut = Array.from(t).slice(0, SUPPORTS_CELL_MAX).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > SUPPORTS_CELL_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}… (in full below)`;
};

/** Who scanned what and when: "Prowler (AWS) 5.44.0, account 123456789012, 9 Oct 2026 at 3:04 pm". */
const evidenceHeader = (ev: Evidence) =>
  [`${ev.source}${ev.toolVersion ? ` ${ev.toolVersion}` : ""}`, ev.account ? `account ${ev.account}` : "", stampText(new Date(ev.scannedAt))].join(", ");

const checkSetting = (c: Evidence["checks"][number]) => `${c.count ? `${c.count}: ` : ""}${c.setting || c.id}`;

const INLINE_EVIDENCE_LIMIT = 6;
const PASSES_SHOWN = 6;
const RISKS_SHOWN = 6;
const GAPS_SHOWN = 6;

/** Sections actually rendered, for the contents page and its outline entries. */
const tocFor = (model: ReportModel) => [
  { id: "about", title: "About this report" },
  { id: "executive-summary", title: "Executive summary" },
  { id: "crown-jewel-register", title: "Crown-jewel register" },
  { id: "risk-register", title: "Risk register" },
  { id: "findings", title: "Findings by domain" },
  ...(model.notApplicable.length ? [{ id: "not-applicable", title: "Controls marked not applicable" }] : []),
  { id: "roadmap", title: "Remediation roadmap" },
  { id: "frameworks", title: "Framework alignment" },
  ...(model.essentials ? [{ id: "essentials", title: "ASD Essentials (indicative)" }] : []),
  ...(model.idcf ? [{ id: "idcf", title: "IDCF Data Security Levels (indicative)" }] : []),
  ...(model.soc ? [{ id: "soc", title: "SOC maturity (indicative)" }] : []),
  ...(model.aiRegister ? [{ id: "ai-register", title: "AI use-case register" }] : []),
  { id: "method", title: "Method and limitations" },
  { id: "references", title: "References" },
  ...(model.scanEvidence.length ? [{ id: "appendix-a", title: "Appendix A: Scan evidence" }] : []),
];

export function ReportDocument({ model }: { model: ReportModel }) {
  return (
    <ReportShell header={model.header} title="Crown-jewel risk assessment" coverLine={andList(model.platformNames)}>
      <Contents model={model} />
      <About model={model} />
      <ExecutiveSummary model={model} />
      <CrownJewelRegister model={model} />
      <RiskRegister model={model} />
      <Findings model={model} />
      {model.notApplicable.length > 0 && <NotApplicable model={model} />}
      <Roadmap model={model} />
      <Frameworks model={model} />
      {model.essentials && <EssentialsSection essentials={model.essentials} />}
      {model.soc && <SocSection soc={model.soc} />}
      {model.aiRegister && <AiRegisterSection register={model.aiRegister} />}
      <Section id="method" title="Method and limitations">
        <Paragraphs items={methodParagraphs(model)} />
      </Section>
      <References model={model} />
      {model.scanEvidence.length > 0 && <ScanEvidenceAppendix model={model} />}
    </ReportShell>
  );
}

/**
 * The standalone AI use-case register: its own cover and "About this register" page, then the same register section
 * the full report uses. It carries no crown-jewel risk, Essential Eight, IDCF, CIS or NIST pages.
 */
export function AiRegisterDocument({ model }: { model: AiRegisterReportModel }) {
  const r = model.aiRegister;
  return (
    <ReportShell header={model.header} title="AI use-case register" coverLine={`${r.entries.length} use case${plural(r.entries.length, "", "s")} in the register`}>
      <AboutRegister model={model} />
      <AiRegisterSection register={r} />
    </ReportShell>
  );
}

function Paragraphs({ items }: { items: string[] }) {
  const { s } = useTheme();
  return items.map((t) => <Text key={t} style={s.p}>{t}</Text>);
}

function Contents({ model }: { model: ReportModel }) {
  const { theme } = useTheme();
  return (
    <Section id="contents" title="Contents" lead="Jump to a section. Page numbers are in the footer of each page.">
      {tocFor(model).map((entry) => (
        <Link key={entry.id} src={`#${entry.id}`} style={{ fontSize: 10, color: theme.heading, marginBottom: 6, lineHeight: 1.4 }}>
          {entry.title}
        </Link>
      ))}
    </Section>
  );
}

function About({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  const { header: h, soc, aiRegister: ai, ismBaseline } = model;
  return (
    <Section id="about" title="About this report">
      <Text style={s.p}>
        This report assesses how well {h.org} protects its crown jewels in {andList(model.platformNames)}. It was
        prepared with crownguard, a guided self-assessment, from answers given by the organisation. It is not an audit or a
        certification.
      </Text>
      <Text style={s.h2}>A point-in-time assessment</Text>
      <Text style={s.p}>
        It reflects answers recorded as at {stampText(h.answersAsAt)} and was generated on {stampText(h.generatedAt)}.
        Configurations, licences, threats and vendor guidance all change, so the findings may not hold after this date.
        Reassess after any significant change, and at least once a year.
      </Text>
      <Text style={s.h2}>Scope</Text>
      <Bullets
        items={[
          ...model.licenceNames,
          `${model.risks.length} crown jewel${plural(model.risks.length, "", "s")} and ${model.questions.length} control questions relevant to them`,
          ...(soc ? [`Optional SOC maturity self-assessment: ${soc.aspects} aspects in ${soc.model.domains.length} domains, aligned to the SOC-CMM® v${soc.version} model`] : []),
          ...(ai
            ? [
                `Optional AI use-case register: ${ai.entries.length} use case${plural(ai.entries.length, "", "s")}, checked against the Policy for the responsible use of AI in government and the agentic AI addendum${ai.examples ? `, including ${ai.examples} example entr${plural(ai.examples, "y", "ies")}` : ""}`,
              ]
            : []),
          ...model.imports.map(
            (imp) =>
              `${imp.applied} answer${plural(imp.applied, "", "s")} pre-filled from an automated ${imp.source}${imp.toolVersion ? ` ${imp.toolVersion}` : ""} scan of ${imp.tenant} run ${stampText(new Date(imp.scannedAt))}, then reviewed by the assessor`,
          ),
          ...(ismBaseline ? [`ISM baseline shown: ${ismBaseline.label} — ${ismBaseline.findings.length} of ${ismBaseline.totalFindings} findings touch controls it includes`] : []),
        ]}
      />
      <Text style={s.h2}>Standards and guidance assessed against</Text>
      <Table
        rows={model.frameworksUsed}
        columns={[
          { header: "Standard or guidance", width: "48%", render: (f) => <Text style={{ fontWeight: 600 }}>{f.name}</Text> },
          { header: "Publisher", width: "22%", render: (f) => f.publisher },
          { header: "How it is used", width: "30%", render: (f) => f.role },
        ]}
      />
      <Text style={{ ...s.small, marginTop: 6 }}>
        Mappings are indicative: they show which recommendations each question relates to, not formal compliance. The method
        and its limitations are set out at the end of the report.
      </Text>
    </Section>
  );
}

function strengthsText(model: ReportModel) {
  const { header: h, strengths: st, essentials, notApplicable } = model;
  const phase1 = essentials?.priorityDomains.map((d) => (d.percentage === null ? `${d.name} not assessed` : `${d.name} ${d.percentage}%`)) ?? [];
  return [
    st.inPlace > 0 ? `${h.org} has ${st.inPlace} of the ${st.assessed} controls assessed fully in place` : `${h.org} assessed ${st.assessed} controls`,
    st.partial > 0 ? `, with a further ${st.partial} partly in place` : "",
    ".",
    st.strongDomains.length > 0 ? ` Its strongest areas are ${andList(st.strongDomains.slice(0, 3).map((d) => `${d.name} (${pct(d.score)})`))}.` : "",
    st.e8Reached.length > 0 ? ` It reaches indicative Essential Eight Maturity Level 1 or above for ${andList(st.e8Reached.map((r) => `${r.title.toLowerCase()} (ML${r.level})`))}.` : "",
    phase1.length ? ` In ASD's Essentials, the priority phase 1 domains show indicative effectiveness of ${andList(phase1)}.` : "",
    notApplicable.length > 0 ? ` ${notApplicable.length} control${plural(notApplicable.length, " was", "s were")} confirmed not applicable, each with a documented reason.` : "",
  ].join("");
}

function focusText(model: ReportModel) {
  const { risks, focus } = model;
  const top = risks[0];
  return [
    `The assessment covered ${risks.length} crown jewel${plural(risks.length, "", "s")} across ${andList(model.platformNames)}.`,
    focus.highOrExtreme > 0
      ? ` ${focus.highOrExtreme} ${plural(focus.highOrExtreme, "is", "are")} rated high or extreme risk${top ? `, led by “${top.jewel.name}” (${top.band.toLowerCase()}, ${riskScore(top.score)})` : ""}, and the priority actions below address them first.`
      : " None is currently rated high or extreme risk.",
    focus.unknown > 0 ? ` ${focus.unknown} control${plural(focus.unknown, " is", "s are")} still unknown and treated as gaps until confirmed.` : "",
  ].join("");
}

function socSummaryText({ result: r, assessed, onTarget, unsure }: NonNullable<ReportModel["soc"]>) {
  if (r.answered === 0 || r.overall === null) return "An optional SOC maturity self-assessment was included, but none of its questions has been answered yet.";
  const below = assessed - onTarget;
  return `An optional self-assessment rated security operations at an indicative ${r.overall.toFixed(1)} of 5 against a target of ${r.overallTarget.toFixed(1)}; ${below} of ${assessed} domains ${plural(below, "is", "are")} below target.${
    unsure ? ` ${unsure} of its ${r.total} questions ${plural(unsure, "is", "are")} unanswered or unknown and scored 0.` : ""
  } It is reported separately and doesn't change the risk ratings.`;
}

function aiSummaryText(r: NonNullable<ReportModel["aiRegister"]>) {
  if (r.entries.length === 0) return "An optional AI use-case register was included, but no use cases have been recorded yet.";
  return `The AI use-case register records ${r.entries.length} use case${plural(r.entries.length, "", "s")}, ${r.inScope} of them in scope of the DTA policy${r.undetermined ? ` and ${r.undetermined} not yet checked` : ""}. ${
    r.openGaps ? `${r.openGaps} readiness gap${plural(r.openGaps, " is", "s are")} open${r.criticalGaps ? `, ${r.criticalGaps} of them critical` : ""}.` : "No readiness gaps are open."
  }${r.examples ? ` ${r.examples} ${plural(r.examples, "entry is", "entries are")} example data, not real use cases.` : ""}`;
}

/** Leads with what is working, then where to focus. */
function ExecutiveSummary({ model }: { model: ReportModel }) {
  const { theme, s } = useTheme();
  const { strengths: st, focus } = model;
  return (
    <Section id="executive-summary" title="Executive summary">
      <Text style={s.p}>{strengthsText(model)}</Text>
      <Text style={s.p}>{focusText(model)}</Text>
      {model.soc && <Text style={s.p}>{socSummaryText(model.soc)}</Text>}
      {model.aiRegister && <Text style={s.p}>{aiSummaryText(model.aiRegister)}</Text>}

      <StatTiles
        large
        tiles={[
          ["Controls in place", `${st.inPlace}/${st.assessed}`, st.partial ? `plus ${st.partial} partly in place` : "fully implemented"],
          ["Control posture", pct(model.posture.score), "Severity-weighted, partial counts half"],
          ["High / extreme risks", String(focus.highOrExtreme), `of ${model.risks.length} crown jewels`],
        ]}
      />

      <Text style={s.h2} minPresenceAhead={60}>What's working well</Text>
      {st.passes.length === 0 ? (
        <Text style={s.p}>No controls are fully in place yet. The priority actions below are the quickest wins.</Text>
      ) : (
        <View>
          {st.passes.slice(0, PASSES_SHOWN).map((q) => (
            <View key={q.id} wrap={false} style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
              <Text style={{ width: 10, color: good, fontWeight: 700 }}>✓</Text>
              <Text style={{ flex: 1, fontSize: 9, lineHeight: 1.4 }}>
                {firstSentence(q.yesLooksLike)} <Text style={{ color: muted, fontSize: 7.5 }}>{q.id}</Text>
              </Text>
            </View>
          ))}
          {st.passes.length > PASSES_SHOWN && <Text style={s.small}>+ {st.passes.length - PASSES_SHOWN} more controls in place.</Text>}
        </View>
      )}

      <Text style={{ ...s.h2, marginTop: 16 }} minPresenceAhead={120}>Where to focus</Text>
      <View style={{ flexDirection: "row", gap: 18, marginTop: 2 }}>
        <View>
          <Text style={{ ...s.h3, color: theme.heading }}>Risk heatmap</Text>
          <Heatmap risks={model.risks} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ ...s.h3, color: theme.heading }}>Highest risks</Text>
          {model.risks.slice(0, RISKS_SHOWN).map((r) => (
            <View key={r.jewel.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3.5, borderBottomWidth: 0.5, borderColor: line }}>
              <Badge {...bandColors[r.band]}>{r.band.toUpperCase()}</Badge>
              <Text style={{ flex: 1, fontWeight: 600 }}>{r.jewel.name}</Text>
              <Text style={s.small}>{riskScore(r.score)} · {r.gaps.length} gaps</Text>
            </View>
          ))}
        </View>
      </View>

      {focus.quickWins.length > 0 && (
        <>
          <Text style={{ ...s.h3, color: theme.heading, marginTop: 14 }} minPresenceAhead={90}>Priority actions (next 30 days)</Text>
          {focus.quickWins.map((r, i) => (
            <View key={r.question.id} wrap={false} style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
              <Text style={{ width: 12, fontWeight: 700, color: theme.heading }}>{i + 1}.</Text>
              <Text style={{ flex: 1 }}>
                <Text style={{ fontWeight: 600 }}>{firstSentence(r.question.remediation)}</Text>
                <Text style={{ color: muted }}> Protects {protects(r.jewels)}. Effort {r.question.effort}.</Text>
              </Text>
            </View>
          ))}
        </>
      )}
    </Section>
  );
}

const scale = Array.from({ length: RISK_SCALE }, (_, i) => i + 1);

function Heatmap({ risks }: { risks: ReportModel["risks"] }) {
  const size = 26;
  return (
    <View>
      {[...scale].reverse().map((impact) => (
        <View key={impact} style={{ flexDirection: "row", gap: 2, marginBottom: 2, alignItems: "center" }}>
          <Text style={{ width: 10, fontSize: 7, color: muted, textAlign: "right", marginRight: 3 }}>{impact}</Text>
          {scale.map((likelihood) => {
            const n = risks.filter((r) => r.impact === impact && r.likelihood === likelihood).length;
            const c = bandColors[bandOf(impact * likelihood)];
            return (
              <View key={likelihood} style={{ width: size, height: size, backgroundColor: c.bg, borderRadius: 2, justifyContent: "center", alignItems: "center" }}>
                {n > 0 && <Text style={{ color: c.fg, fontWeight: 700, fontSize: 10 }}>{n}</Text>}
              </View>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 2, marginLeft: 15 }}>
        {scale.map((l) => <Text key={l} style={{ width: size, textAlign: "center", fontSize: 7, color: muted }}>{l}</Text>)}
      </View>
      <Text style={{ fontSize: 7, color: muted, marginLeft: 15, marginTop: 2 }}>Likelihood → (rows: impact)</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginLeft: 15, marginTop: 4 }}>
        {bands.map((band) => (
          <View key={band} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 8, height: 8, backgroundColor: bandColors[band].bg, borderRadius: 1 }} />
            <Text style={{ fontSize: 7, color: bandColors[band].fg, fontWeight: 600 }}>{band}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function CrownJewelRegister({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  const described = model.risks.filter((r) => r.jewel.description);
  const longSupports = model.risks.filter((r) => supportsInFull(r.jewel.businessProcesses));
  return (
    <Section
      id="crown-jewel-register"
      title="Crown-jewel register"
      lead={`The systems and information whose compromise would most seriously harm the organisation, as identified during this assessment. Impact ratings use 1 (minimal) to ${RISK_SCALE} (severe).${model.risks.some((r) => r.jewel.dsl) ? " IDCF DSL is the Data Security Level the organisation assigned; – means not classified." : ""}`}
    >
      <Table
        rows={model.risks}
        columns={[
          { header: "Crown jewel", width: "24%", render: (r) => (
            <View>
              <Text style={{ fontWeight: 600 }}>{r.jewel.name}</Text>
              <Text style={s.small}>{r.assetTypeName}</Text>
            </View>
          ) },
          { header: "Classification", width: "15%", render: (r) => classifications[r.jewel.classification] },
          { header: "IDCF DSL", width: "8%", render: (r) => (r.jewel.dsl ? dsls[r.jewel.dsl] : "–") },
          { header: "C / I / A", width: "10%", render: (r) => `${r.jewel.confidentiality} / ${r.jewel.integrity} / ${r.jewel.availability}` },
          { header: "Obligations", width: "16%", render: (r) => r.jewel.regulations.map((x) => regulations[x].split(" (")[0]).join("; ") || "–" },
          { header: "Exposure", width: "15%", render: (r) => r.jewel.exposures.map((x) => exposures[x]).join("; ") || "None recorded" },
          { header: "Supports", width: "12%", render: (r) => (r.jewel.businessProcesses ? supportsCell(r.jewel.businessProcesses) : "–") },
        ]}
      />
      {described.length + longSupports.length > 0 && (
        <View style={{ marginTop: 10 }}>
          {described.map((r) => (
            <Text key={r.jewel.id} style={{ ...s.p, fontSize: 8.5 }}>
              <Text style={{ fontWeight: 600 }}>{r.jewel.name}: </Text>
              {r.jewel.description}
            </Text>
          ))}
          {longSupports.map((r) => (
            <Text key={`${r.jewel.id}-supports`} style={{ ...s.p, fontSize: 8.5 }}>
              <Text style={{ fontWeight: 600 }}>{r.jewel.name} supports: </Text>
              {r.jewel.businessProcesses}
            </Text>
          ))}
        </View>
      )}
    </Section>
  );
}

function RiskRegister({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  return (
    <Section
      id="risk-register"
      title="Risk register"
      lead={`Risk = impact × likelihood (${RISK_SCALE}×${RISK_SCALE}). Impact is the highest of the confidentiality, integrity and availability ratings, raised one level for regulated or highly confidential data. Likelihood reflects unmet controls weighted by severity, plus recorded exposures.`}
    >
      {model.risks.map((r) => (
        <View key={r.jewel.id} wrap={false} style={{ borderWidth: 0.5, borderColor: line, borderLeftWidth: 3, borderLeftColor: bandColors[r.band].fg, borderRadius: 3, padding: 9, marginBottom: 9 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Text style={{ ...s.h3, marginBottom: 0, flex: 1 }}>{r.jewel.name}</Text>
            <Badge {...bandColors[r.band]}>{`${r.band.toUpperCase()} · ${riskScore(r.score)}`}</Badge>
          </View>
          <Text style={s.small}>
            {r.assetTypeName} · Impact {r.impact} · Likelihood {r.likelihood} · Confidence {pct(r.confidence)}
          </Text>
          {r.gaps.length === 0 ? (
            <Text style={{ marginTop: 5 }}>All relevant controls are in place.</Text>
          ) : (
            <View style={{ marginTop: 5 }}>
              {r.gaps.slice(0, GAPS_SHOWN).map((g) => (
                <View key={g.question.id} style={{ flexDirection: "row", gap: 5, marginBottom: 2 }}>
                  <Text style={{ width: 44, fontSize: 7, color: severityColors[g.question.severity], fontWeight: 600, textTransform: "uppercase", paddingTop: 1 }}>{g.question.severity}</Text>
                  <Text style={{ flex: 1, fontSize: 8.5 }}>{g.question.question} <Text style={{ color: muted }}>({answerText(g.answer)})</Text></Text>
                </View>
              ))}
              {r.gaps.length > GAPS_SHOWN && <Text style={s.small}>+ {r.gaps.length - GAPS_SHOWN} further gaps listed under Findings.</Text>}
            </View>
          )}
        </View>
      ))}
    </Section>
  );
}

function Findings({ model }: { model: ReportModel }) {
  const { theme, s } = useTheme();
  return (
    <Section id="findings" title="Findings by domain" lead="Every control that isn't fully in place, grouped by domain, with the recommended fix. Licence notes show where the fix needs a product your current licence doesn't include.">
      <View style={{ marginBottom: 10 }}>
        {model.domains.map((d) => (
          <View key={`${d.platform}:${d.domain}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <Text style={{ width: 150, fontSize: 8.5 }}>{d.name}</Text>
            <View style={{ flex: 1 }}><Meter value={d.score} color={theme.heading} /></View>
            <Text style={{ width: 30, textAlign: "right", fontSize: 8.5 }}>{pct(d.score)}</Text>
          </View>
        ))}
      </View>
      {model.findings.map(({ domain: d, items }) => (
        <View key={`${d.platform}:${d.domain}`}>
          <Text style={s.h2} minPresenceAhead={60}>{d.name}</Text>
          {items.map((f) => (
            <FindingCard key={f.question.id} finding={f} ismBaseline={model.ismBaseline?.label} />
          ))}
        </View>
      ))}
    </Section>
  );
}

function FindingCard({ finding: f, ismBaseline }: { finding: Finding; ismBaseline?: string }) {
  const { s } = useTheme();
  const q = f.question;
  return (
    <View style={{ marginBottom: 8, paddingBottom: 6, borderBottomWidth: 0.5, borderColor: line }}>
      <View wrap={false}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 2 }}>
          <Text style={{ fontSize: 7, color: severityColors[q.severity], fontWeight: 700, textTransform: "uppercase" }}>{q.severity}</Text>
          <Text style={s.small}>{q.id} · Answer: {answerText(f.answer)} · Effort {q.effort}</Text>
        </View>
        <Text style={{ fontWeight: 600, marginBottom: 2 }}>{q.question}</Text>
        <Text style={{ fontSize: 8.5, color: muted, marginBottom: 2 }}>{q.why}</Text>
        <Text style={{ fontSize: 8.5 }}><Text style={{ fontWeight: 600 }}>Recommendation: </Text>{q.remediation}</Text>
        {f.licenceGap.length > 0 && <Text style={{ fontSize: 8, color: caution, marginTop: 2 }}>Licence: needs {f.licenceGap.join(", ")}.</Text>}
      </View>
      {/* Notes can be long, so they sit outside the unbreakable block and may run across a page break. */}
      {f.note && <Text style={{ fontSize: 8, marginTop: 2, fontStyle: "italic" }}>Note: {f.note}</Text>}
      {f.evidence && (
        <Text style={{ fontSize: 8, marginTop: 2, color: muted }}>
          Scan evidence ({evidenceHeader(f.evidence)}):{" "}
          {f.evidence.checks
            .slice(0, INLINE_EVIDENCE_LIMIT)
            .map((c) => `${checkSetting(c)} – ${c.status}${c.examples?.length ? ` (${c.examples.slice(0, 3).join(", ")})` : ""}`)
            .join("; ")}
          {f.evidence.checks.length > INLINE_EVIDENCE_LIMIT ? `; +${f.evidence.checks.length - INLINE_EVIDENCE_LIMIT} more in Appendix A` : ""}
        </Text>
      )}
      <Text style={{ ...s.small, marginTop: 2 }}>{f.refs.join(" · ")}</Text>
      {f.ismBaseline.length > 0 && <Text style={{ ...s.small, marginTop: 1 }}>Touches the ISM {ismBaseline} baseline: {f.ismBaseline.join(", ")}</Text>}
    </View>
  );
}

function NotApplicable({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  return (
    <Section id="not-applicable" title="Controls marked not applicable" lead="Controls the organisation answered N/A, with the reason it gave. They are left out of scoring, so check each reason holds: a wrong N/A hides a real gap.">
      <Table
        rows={model.notApplicable}
        columns={[
          { header: "Control", width: "50%", render: (r) => (
            <View>
              <Text style={{ fontWeight: 600 }}>{r.question.question}</Text>
              <Text style={s.small}>{r.question.id} · {r.question.severity}</Text>
            </View>
          ) },
          { header: "Reason given", width: "50%", render: (r) => r.reason },
        ]}
      />
    </Section>
  );
}

function Roadmap({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  const byPhase = phases.map((phase) => ({ phase, items: model.roadmap.filter((r) => r.phase === phase) })).filter((p) => p.items.length > 0);
  return (
    <Section id="roadmap" title="Remediation roadmap" lead="Gaps ranked by how much risk they remove, per unit of effort, across the crown jewels on each control's platform. Critical gaps that can be fixed with small or medium effort are brought into the first 30 days.">
      {byPhase.map(({ phase, items }) => (
        <View key={phase}>
          <Text style={s.h2} minPresenceAhead={60}>{phase}</Text>
          <Table<RoadmapItem>
            rows={items}
            columns={[
              { header: "Action", width: "56%", render: (r) => (
                <View>
                  <Text style={{ fontWeight: 600 }}>{firstSentence(r.question.remediation)}</Text>
                  <Text style={s.small}>{r.question.id} · {r.question.question}</Text>
                </View>
              ) },
              { header: "Severity", width: "11%", render: (r) => <Text style={{ color: severityColors[r.question.severity], fontWeight: 600, textTransform: "capitalize" }}>{r.question.severity}</Text> },
              { header: "Effort", width: "8%", render: (r) => r.question.effort },
              { header: "Protects", width: "25%", render: (r) => protects(r.jewels) },
            ]}
          />
        </View>
      ))}
    </Section>
  );
}

function Frameworks({ model }: { model: ReportModel }) {
  const { theme, s } = useTheme();
  const { ismBaseline } = model;
  return (
    <Section id="frameworks" title="Framework alignment" lead="How your answers map to the ASD Essential Eight, NIST Cybersecurity Framework 2.0, CIS Benchmarks, the Australian Government Information Security Manual (ISM) and the Department of Home Affairs Industry Data Classification Framework (IDCF). These are indicative: they cover only the cloud-platform controls asked in this assessment and are not a formal audit.">
      <Text style={s.h2}>ASD Essential Eight (indicative maturity)</Text>
      <Table
        rows={model.e8}
        columns={[
          { header: "Mitigation strategy", width: "46%", render: (r) => r.title },
          { header: "Indicative level", width: "18%", render: (r) => (r.level === null ? "Not assessed" : `ML${r.level}`) },
          { header: "Asked up to", width: "14%", render: (r) => (r.ceiling ? `ML${r.ceiling}` : "–") },
          { header: "Blocking gaps", width: "22%", render: (r) => r.blockers.map((q) => q.id).join(", ") || (r.unasked ? `ML${r.unasked} not covered by this assessment` : "–") },
        ]}
      />
      {model.idcf && <IdcfSection idcf={model.idcf} />}
      <Text style={s.h2} minPresenceAhead={80}>NIST CSF 2.0 functions</Text>
      {model.csf.map((c) => (
        <View key={c.fn} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <Text style={{ width: 70 }}>{c.fn}</Text>
          <View style={{ flex: 1 }}><Meter value={c.score} color={theme.heading} /></View>
          <Text style={{ width: 30, textAlign: "right" }}>{pct(c.score)}</Text>
          <Text style={{ ...s.small, width: 90, textAlign: "right" }}>{c.subcategories} {plural(c.subcategories, "subcategory", "subcategories")}</Text>
        </View>
      ))}
      {model.cis.length > 0 && (
        <>
          <Text style={s.h2} minPresenceAhead={80}>CIS Benchmark recommendations</Text>
          <Text style={{ ...s.small, marginBottom: 6 }}>Recommendation numbers and titles only. Refer to the CIS Benchmark for audit and remediation procedures.</Text>
          <Table
            rows={model.cis}
            columns={[
              { header: "Benchmark", width: "16%", render: (r) => r.frameworkName },
              { header: "Rec.", width: "10%", render: (r) => r.ref },
              { header: "Title", width: "52%", render: (r) => r.title ?? "" },
              { header: "Status", width: "22%", render: (r) => r.status },
            ]}
          />
        </>
      )}
      {model.ism.length > 0 && (
        <>
          <Text style={s.h2} minPresenceAhead={80}>{model.ismName} controls</Text>
          <Text style={{ ...s.small, marginBottom: 6 }}>
            Control ids and shortened statements generated from ASD&apos;s ISM OSCAL catalogue; the ISM itself has the full
            guidance. Alignment is indicative: it shows which ISM controls each question relates to, not that the
            organisation meets them.
            {ismBaseline
              ? ` The ${ismBaseline.label} baseline covers ${ismBaseline.findings.length} of the ${ismBaseline.totalFindings} findings in this report, across ${ismBaseline.controls} of the ISM controls mapped here.`
              : ""}
          </Text>
          <Table
            rows={model.ism}
            columns={[
              { header: "Control", width: "14%", render: (r) => r.ref },
              { header: "What it asks (shortened)", width: "64%", render: (r) => r.title ?? "" },
              { header: "Status", width: "22%", render: (r) => r.status },
            ]}
          />
        </>
      )}
    </Section>
  );
}

function References({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  return (
    <Section id="references" title="References" lead={`Guidance consulted for the questions in this report. Retrieved dates show when each source was last checked${model.sourcesLastChecked ? `; the watch last ran on ${model.sourcesLastChecked}` : ""}.`}>
      {model.idcf && (
        <Text style={{ ...s.small, marginBottom: 8 }}>
          Contains material adapted from the Industry Data Classification Framework, © Commonwealth of Australia 2026 and © Commonwealth Scientific and
          Industrial Research Organisation (CSIRO) 2026, licensed under CC BY 4.0 (creativecommons.org/licenses/by/4.0), and from “IDCF: A guide to system
          security”, Australian Government Department of Home Affairs, CC BY 3.0 AU. Summaries are crownguard&apos;s own and do not imply endorsement.
        </Text>
      )}
      {model.ism.length > 0 && (
        <Text style={{ ...s.small, marginBottom: 8 }}>
          ISM control titles are shortened statements from the Information Security Manual, © Commonwealth of Australia 2024, generated from ASD&apos;s ISM
          OSCAL catalogue and used under CC BY 4.0 (creativecommons.org/licenses/by/4.0), Coat of Arms and ASD logo excepted. The shortening is
          crownguard&apos;s own and does not imply endorsement.
        </Text>
      )}
      {model.essentials && (
        <Text style={{ ...s.small, marginBottom: 8 }}>
          ASD Essentials action titles are shortened statements from ASD&apos;s {model.essentials.framework.name}, © Commonwealth of Australia 2026, used under CC
          BY 4.0 (creativecommons.org/licenses/by/4.0), Coat of Arms and ASD logo excepted. The shortening and the indicative ratings are crownguard&apos;s
          own and do not imply endorsement.
        </Text>
      )}
      <SourceList sources={model.sources} />
    </Section>
  );
}

function ScanEvidenceAppendix({ model }: { model: ReportModel }) {
  const { s } = useTheme();
  return (
    <Section
      id="appendix-a"
      title="Appendix A: Scan evidence"
      lead="Every mapped scan check attached to a finding, grouped by question, tool and scan date. Status, setting and expected value are listed in full; the findings section keeps only a short summary."
    >
      {model.scanEvidence.map(({ question: q, evidence: ev }) => (
        <View key={q.id} style={{ marginBottom: 10 }}>
          <Text style={s.h2} minPresenceAhead={60}>
            {q.id}: {q.question}
          </Text>
          <Text style={{ ...s.small, marginBottom: 4 }}>{evidenceHeader(ev)}</Text>
          <Table
            repeatHeader
            rows={ev.checks}
            columns={[
              { header: "Status", width: "12%", render: (c) => c.status },
              { header: "Setting", width: "44%", render: checkSetting },
              { header: "Expected", width: "44%", render: (c) => c.expected || "–" },
            ]}
          />
        </View>
      ))}
    </Section>
  );
}

function AboutRegister({ model }: { model: AiRegisterReportModel }) {
  const { s } = useTheme();
  const { header: h } = model;
  return (
    <Section id="about-register" title="About this register">
      <Text style={s.p}>
        This is the register of AI use cases kept by {h.org}, recorded with the minimum fields in the Digital
        Transformation Agency&apos;s Standard for accountability. It was prepared with crownguard, a guided
        self-assessment, from entries the organisation recorded itself. It is not an audit or a certification.
      </Text>
      <Text style={s.h2}>Who the policy applies to</Text>
      <Text style={s.p}>{model.aiRegister.model.appliesTo}</Text>
      <Text style={s.h2}>A point-in-time register</Text>
      <Text style={s.p}>
        It reflects the entries and answers recorded as at {stampText(h.answersAsAt)} and was generated on{" "}
        {stampText(h.generatedAt)}. Use cases, owners, dates and policy guidance all change, so update the
        register after any significant change and review it at least once a year.
      </Text>
      <Text style={s.h2}>Readiness is an indicative self-check</Text>
      <Text style={s.p}>
        Each use case&apos;s readiness is crownguard&apos;s severity-weighted summary of the requirements in the
        policy for the responsible use of AI in government, its standards and guidance, and the agentic AI addendum.
        It is an indicative self-check, not a policy compliance finding and not an assessment by the DTA. The risk
        ratings are copied from the organisation&apos;s own AI impact assessment; crownguard records them and
        doesn&apos;t work them out.
      </Text>
      <Text style={s.h2}>Sources</Text>
      <SourceList sources={model.sources} />
    </Section>
  );
}

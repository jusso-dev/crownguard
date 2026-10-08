import { Circle, Document, Image, Line, Link, Page, Polygon, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { exposures } from "../content/schema";
import { formatAbn, isValidAbn } from "../engine/abn";
import { bandOf } from "../engine/risk";
import { levelFor, socProviders, type SocResult } from "../engine/soc";
import { answerLabels, classifications, dsls, regulations, type Answer } from "../engine/types";
import { notVerifiedText, type IdcfCell } from "../engine/idcf";
import type { ReportModel } from "./model";
import { Badge, bandColors, good, ink, line, Meter, muted, pct, severityColors, Table } from "./primitives";

const answerText = (a: Answer | undefined) => (a ? answerLabels[a] : "Unanswered");
const protects = (jewels: { name: string }[]) =>
  jewels.length === 0
    ? "the whole environment"
    : jewels.length <= 3
      ? jewels.map((j) => j.name).join(", ")
      : `${jewels.slice(0, 2).map((j) => j.name).join(", ")} and ${jewels.length - 2} more`;
const firstSentence = (t: string) => t.split(/(?<=\.)\s/)[0];
const listText = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const sentence = (t: string) => (/[.?!]$/.test(t) ? t : `${t}.`);
/** Full timestamp with time zone, e.g. "8 October 2026 at 5:42 pm AEDT". */
const stampText = (d: Date) =>
  d.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

type Styles = ReturnType<typeof makeStyles>;

const makeStyles = (theme: ReportModel["theme"]) =>
  StyleSheet.create({
    page: { fontFamily: "Inter", fontSize: 9, color: ink, paddingTop: 54, paddingBottom: 54, paddingHorizontal: 46 },
    h1: { fontSize: 20, fontWeight: 700, color: theme.heading, marginBottom: 4 },
    h2: { fontSize: 12.5, fontWeight: 600, color: theme.heading, marginTop: 14, marginBottom: 6 },
    h3: { fontSize: 10, fontWeight: 600, marginBottom: 3 },
    // lineHeight is set per text style, never on Page or View: inherited into the fixed page-number footer it breaks react-pdf layout.
    lead: { fontSize: 10, color: muted, marginBottom: 12, lineHeight: 1.4 },
    rule: { height: 2, width: 36, backgroundColor: theme.accent, marginBottom: 14 },
    small: { fontSize: 7.5, color: muted },
    p: { fontSize: 9, marginBottom: 6, lineHeight: 1.4 },
  });

function Section({ s, title, lead, children, breakBefore = true }: { s: Styles; title: string; lead?: string; children: ReactNode; breakBefore?: boolean }) {
  return (
    <View break={breakBefore}>
      <Text style={s.h1} minPresenceAhead={80}>{title}</Text>
      <View style={s.rule} />
      {lead && <Text style={s.lead}>{lead}</Text>}
      {children}
    </View>
  );
}

export function ReportDocument({ model }: { model: ReportModel }) {
  const { assessment: a, theme } = model;
  const s = makeStyles(theme);

  const st = model.strengths;
  const e8Reached = model.e8.filter((r) => (r.level ?? 0) >= 1);
  const extreme = model.risks.filter((r) => r.band === "Extreme").length;
  const high = model.risks.filter((r) => r.band === "High").length;
  const top = model.risks[0];
  const quickWins = model.roadmap.filter((r) => r.phase === "0–30 days").slice(0, 5);
  const unknownCount = model.questions.filter((q) => (model.answers[q.id] ?? "unknown") === "unknown").length;
  const tableProps = { headerBg: theme.tint, zebra: "#fafbfc" };

  return (
    <Document title={`${a.org.name} – Crown-jewel risk assessment`} author={a.branding.preparedBy || a.org.name} creator="crownguard" producer="crownguard" subject="Crown-jewel risk assessment" creationDate={model.generatedAt}>
      {/* Cover */}
      <Page size="A4" style={{ fontFamily: "Inter", backgroundColor: theme.primary, color: theme.onPrimary, padding: 56 }}>
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, backgroundColor: theme.accent }} />
        <Text style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textAlign: "center", marginTop: 4 }}>{a.branding.marking}</Text>
        {a.branding.logoDataUrl && (
          <View
            style={
              a.branding.logoBackdrop === "white"
                ? { marginTop: 70, alignSelf: "flex-start", backgroundColor: "#ffffff", padding: 12, borderRadius: 4 }
                : { marginTop: 70, alignSelf: "flex-start" }
            }
          >
            <Image src={a.branding.logoDataUrl} style={{ maxHeight: 72, maxWidth: 240, objectFit: "contain" }} />
          </View>
        )}
        <View style={{ marginTop: a.branding.logoDataUrl ? 120 : 220 }}>
          <Text style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.85 }}>Crown-jewel risk assessment</Text>
          <Text style={{ fontSize: 32, fontWeight: 700, marginTop: 8, lineHeight: 1.15 }}>{a.org.name}</Text>
          {a.org.abn && isValidAbn(a.org.abn) && <Text style={{ fontSize: 11, marginTop: 6, opacity: 0.9 }}>ABN {formatAbn(a.org.abn)}</Text>}
          <View style={{ height: 3, width: 56, backgroundColor: theme.accent, marginTop: 18, marginBottom: 18 }} />
          <Text style={{ fontSize: 12 }}>{model.platformNames.join(" and ")}</Text>
        </View>
        <View style={{ position: "absolute", bottom: 72, left: 56, right: 56, fontSize: 9.5, lineHeight: 1.6 }}>
          {a.branding.preparedFor && <Text>Prepared for: {a.branding.preparedFor}</Text>}
          {a.branding.preparedBy && <Text>Prepared by: {a.branding.preparedBy}</Text>}
          <Text>Generated: {stampText(model.generatedAt)}</Text>
          <Text>Answers as at: {stampText(new Date(a.updatedAt))}</Text>
        </View>
        <Text style={{ position: "absolute", bottom: 30, left: 0, right: 0, textAlign: "center", fontSize: 9, fontWeight: 700, letterSpacing: 1.2 }}>{a.branding.marking}</Text>
      </Page>

      <Page size="A4" style={s.page}>
        <View fixed style={{ position: "absolute", top: 20, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: muted }}>
          <Text>{a.org.name}</Text>
          <Text style={{ fontWeight: 700, color: ink }}>{a.branding.marking}</Text>
          <Text>Crown-jewel risk assessment</Text>
        </View>
        <View fixed style={{ position: "absolute", bottom: 22, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: muted, borderTopWidth: 0.5, borderColor: line, paddingTop: 6 }}>
          <Text>Generated {stampText(model.generatedAt)}</Text>
          <Text style={{ fontWeight: 700, color: ink }}>{a.branding.marking}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* About */}
        <Section s={s} title="About this report" breakBefore={false}>
          <Text style={s.p}>
            This report assesses how well {a.org.name} protects its crown jewels in {model.platformNames.join(" and ")}. It was
            prepared with crownguard, a guided self-assessment, from answers given by the organisation. It is not an audit or a
            certification.
          </Text>
          <Text style={s.h2}>A point-in-time assessment</Text>
          <Text style={s.p}>
            It reflects answers recorded as at {stampText(new Date(a.updatedAt))} and was generated on {stampText(model.generatedAt)}.
            Configurations, licences, threats and vendor guidance all change, so the findings may not hold after this date.
            Reassess after any significant change, and at least once a year.
          </Text>
          <Text style={s.h2}>Scope</Text>
          {[
            ...model.licenceNames,
            `${model.risks.length} crown jewel${model.risks.length === 1 ? "" : "s"} and ${model.questions.length} control questions relevant to them`,
            ...(model.soc
              ? [
                  `Optional SOC maturity self-assessment: ${model.soc.model.domains.reduce((n, d) => n + d.aspects.length, 0)} aspects in ${model.soc.model.domains.length} domains, aligned to the SOC-CMM® v2.4 model`,
                ]
              : []),
            ...(a.imports ?? []).map(
              (imp) =>
                `${imp.applied} answer${imp.applied === 1 ? "" : "s"} pre-filled from an automated ${imp.source} scan of ${imp.tenant} run ${stampText(new Date(imp.scannedAt))}, then reviewed by the assessor`,
            ),
          ].map((line) => (
            <View key={line} style={{ flexDirection: "row", gap: 6, marginBottom: 3 }}>
              <Text style={{ width: 8, color: theme.heading }}>•</Text>
              <Text style={{ flex: 1, fontSize: 9, lineHeight: 1.4 }}>{line}</Text>
            </View>
          ))}
          <Text style={s.h2}>Standards and guidance assessed against</Text>
          <Table
            {...tableProps}
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

        {/* Executive summary */}
        <Section s={s} title="Executive summary">
          {/* Lead with what is working, then where to focus. */}
          <Text style={s.p}>
            {st.inPlace > 0
              ? `${a.org.name} has ${st.inPlace} of the ${st.assessed} controls assessed fully in place`
              : `${a.org.name} assessed ${st.assessed} controls`}
            {st.partial > 0 ? `, with a further ${st.partial} partly in place` : ""}.
            {st.strongDomains.length > 0 ? ` Its strongest areas are ${listText(st.strongDomains.slice(0, 3).map((d) => `${d.name} (${pct(d.score)})`))}.` : ""}
            {e8Reached.length > 0 ? ` It reaches indicative Essential Eight Maturity Level 1 or above for ${listText(e8Reached.map((r) => `${r.title.toLowerCase()} (ML${r.level})`))}.` : ""}
            {model.notApplicable.length > 0
              ? ` ${model.notApplicable.length} control${model.notApplicable.length === 1 ? " was" : "s were"} confirmed not applicable, each with a documented reason.`
              : ""}
          </Text>
          <Text style={s.p}>
            The assessment covered {model.risks.length} crown jewel{model.risks.length === 1 ? "" : "s"} across {model.platformNames.join(" and ")}.
            {extreme + high > 0
              ? ` ${extreme + high} ${extreme + high === 1 ? "is" : "are"} rated high or extreme risk${top ? `, led by “${top.jewel.name}” (${top.band.toLowerCase()}, ${top.score}/25)` : ""}, and the priority actions below address them first.`
              : " None is currently rated high or extreme risk."}
            {unknownCount > 0 ? ` ${unknownCount} control${unknownCount === 1 ? " is" : "s are"} still unknown and treated as gaps until confirmed.` : ""}
          </Text>
          {model.soc && (
            <Text style={s.p}>
              {(() => {
                const r = model.soc.result;
                if (r.answered === 0 || r.overall === null) return "An optional SOC maturity self-assessment was included, but none of its questions has been answered yet.";
                const below = r.domains.filter((d) => d.maturity !== null && d.maturity < d.target.maturity).length;
                const assessed = r.domains.filter((d) => d.maturity !== null).length;
                const unsure = r.total - r.answered + r.unknown;
                return `An optional self-assessment rated security operations at an indicative ${r.overall.toFixed(1)} of 5 against a target of ${r.overallTarget.toFixed(1)}; ${below} of ${assessed} domains ${below === 1 ? "is" : "are"} below target.${
                  unsure ? ` ${unsure} of its ${r.total} questions ${unsure === 1 ? "is" : "are"} unanswered or unknown and scored 0.` : ""
                } It is reported separately and doesn't change the risk ratings.`;
              })()}
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 6 }}>
            {[
              ["Controls in place", `${st.inPlace}/${st.assessed}`, st.partial ? `plus ${st.partial} partly in place` : "fully implemented"],
              ["Control posture", pct(model.posture.score), "Severity-weighted, partial counts half"],
              ["High / extreme risks", String(extreme + high), `of ${model.risks.length} crown jewels`],
            ].map(([label, value, hint]) => (
              <View key={label} style={{ flex: 1, backgroundColor: theme.tint, borderRadius: 4, padding: 10 }}>
                <Text style={{ ...s.small, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
                <Text style={{ fontSize: 22, fontWeight: 700, color: theme.heading, marginTop: 2 }}>{value}</Text>
                <Text style={s.small}>{hint}</Text>
              </View>
            ))}
          </View>

          <Text style={s.h2} minPresenceAhead={60}>What's working well</Text>
          {st.passes.length === 0 ? (
            <Text style={s.p}>No controls are fully in place yet. The priority actions below are the quickest wins.</Text>
          ) : (
            <View>
              {st.passes.slice(0, 6).map((q) => (
                <View key={q.id} wrap={false} style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
                  <Text style={{ width: 10, color: good, fontWeight: 700 }}>✓</Text>
                  <Text style={{ flex: 1, fontSize: 9, lineHeight: 1.4 }}>
                    {firstSentence(q.yesLooksLike)} <Text style={{ color: muted, fontSize: 7.5 }}>{q.id}</Text>
                  </Text>
                </View>
              ))}
              {st.passes.length > 6 && <Text style={s.small}>+ {st.passes.length - 6} more controls in place.</Text>}
            </View>
          )}

          <Text style={{ ...s.h2, marginTop: 16 }} minPresenceAhead={120}>Where to focus</Text>
          <View style={{ flexDirection: "row", gap: 18, marginTop: 2 }}>
            <View>
              <Text style={{ ...s.h3, color: theme.heading }}>Risk heatmap</Text>
              <Heatmap model={model} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...s.h3, color: theme.heading }}>Highest risks</Text>
              {model.risks.slice(0, 6).map((r) => (
                <View key={r.jewel.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 3.5, borderBottomWidth: 0.5, borderColor: line }}>
                  <Badge {...bandColors[r.band]}>{r.band.toUpperCase()}</Badge>
                  <Text style={{ flex: 1, fontWeight: 600 }}>{r.jewel.name}</Text>
                  <Text style={s.small}>{r.score}/25 · {r.gaps.length} gaps</Text>
                </View>
              ))}
            </View>
          </View>

          {quickWins.length > 0 && (
            <>
              <Text style={{ ...s.h3, color: theme.heading, marginTop: 14 }} minPresenceAhead={90}>Priority actions (next 30 days)</Text>
              {quickWins.map((r, i) => (
                <View key={r.question.id} wrap={false} style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
                  <Text style={{ width: 12, fontWeight: 700, color: theme.heading }}>{i + 1}.</Text>
                  <Text style={{ flex: 1 }}>
                    <Text style={{ fontWeight: 600 }}>{r.question.remediation.split(/(?<=\.)\s/)[0]}</Text>
                    <Text style={{ color: muted }}> Protects {protects(r.jewels)}. Effort {r.question.effort}.</Text>
                  </Text>
                </View>
              ))}
            </>
          )}
        </Section>

        {/* Crown-jewel register */}
        <Section
          s={s}
          title="Crown-jewel register"
          lead={`The systems and information whose compromise would most seriously harm the organisation, as identified during this assessment. Impact ratings use 1 (minimal) to 5 (severe).${a.jewels.some((j) => j.dsl) ? " IDCF DSL is the Data Security Level the organisation assigned; – means not classified." : ""}`}
        >
          <Table
            {...tableProps}
            rows={model.risks}
            columns={[
              { header: "Crown jewel", width: "24%", render: (r) => (
                <View>
                  <Text style={{ fontWeight: 600 }}>{r.jewel.name}</Text>
                  <Text style={s.small}>{model.assetTypeName(r.jewel.assetType)}</Text>
                </View>
              ) },
              { header: "Classification", width: "15%", render: (r) => classifications[r.jewel.classification] },
              { header: "IDCF DSL", width: "8%", render: (r) => (r.jewel.dsl ? dsls[r.jewel.dsl] : "–") },
              { header: "C / I / A", width: "10%", render: (r) => `${r.jewel.confidentiality} / ${r.jewel.integrity} / ${r.jewel.availability}` },
              { header: "Obligations", width: "16%", render: (r) => r.jewel.regulations.map((x) => regulations[x].split(" (")[0]).join("; ") || "–" },
              { header: "Exposure", width: "15%", render: (r) => r.jewel.exposures.map((x) => exposures[x]).join("; ") || "None recorded" },
              { header: "Supports", width: "12%", render: (r) => r.jewel.businessProcesses || "–" },
            ]}
          />
          {model.risks.some((r) => r.jewel.description) && (
            <View style={{ marginTop: 10 }}>
              {model.risks.filter((r) => r.jewel.description).map((r) => (
                <Text key={r.jewel.id} style={{ ...s.p, fontSize: 8.5 }}>
                  <Text style={{ fontWeight: 600 }}>{r.jewel.name}: </Text>
                  {r.jewel.description}
                </Text>
              ))}
            </View>
          )}
        </Section>

        {/* Risk register */}
        <Section s={s} title="Risk register" lead="Risk = impact × likelihood (5×5). Impact is the highest of the confidentiality, integrity and availability ratings, raised one level for regulated or highly confidential data. Likelihood reflects unmet controls weighted by severity, plus recorded exposures.">
          {model.risks.map((r) => {
            const asset = model.assetTypeName(r.jewel.assetType);
            return (
              <View key={r.jewel.id} wrap={false} style={{ borderWidth: 0.5, borderColor: line, borderLeftWidth: 3, borderLeftColor: bandColors[r.band].fg, borderRadius: 3, padding: 9, marginBottom: 9 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ ...s.h3, marginBottom: 0, flex: 1 }}>{r.jewel.name}</Text>
                  <Badge {...bandColors[r.band]}>{`${r.band.toUpperCase()} · ${r.score}/25`}</Badge>
                </View>
                <Text style={s.small}>
                  {asset} · Impact {r.impact} · Likelihood {r.likelihood} · Confidence {pct(r.confidence)}
                </Text>
                {r.gaps.length === 0 ? (
                  <Text style={{ marginTop: 5 }}>All relevant controls are in place.</Text>
                ) : (
                  <View style={{ marginTop: 5 }}>
                    {r.gaps.slice(0, 6).map((g) => (
                      <View key={g.question.id} style={{ flexDirection: "row", gap: 5, marginBottom: 2 }}>
                        <Text style={{ width: 44, fontSize: 7, color: severityColors[g.question.severity], fontWeight: 600, textTransform: "uppercase", paddingTop: 1 }}>{g.question.severity}</Text>
                        <Text style={{ flex: 1, fontSize: 8.5 }}>{g.question.question} <Text style={{ color: muted }}>({answerText(g.answer)})</Text></Text>
                      </View>
                    ))}
                    {r.gaps.length > 6 && <Text style={s.small}>+ {r.gaps.length - 6} further gaps listed under Findings.</Text>}
                  </View>
                )}
              </View>
            );
          })}
        </Section>

        {/* Findings */}
        <Section s={s} title="Findings by domain" lead="Every control that isn't fully in place, grouped by domain, with the recommended fix. Licence notes show where the fix needs a product your current licence doesn't include.">
          <View style={{ marginBottom: 10 }}>
            {model.domains.map((d) => (
              <View key={`${d.platform}:${d.domain}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <Text style={{ width: 150, fontSize: 8.5 }}>{d.name}</Text>
                <View style={{ flex: 1 }}><Meter value={d.score} color={theme.heading} /></View>
                <Text style={{ width: 30, textAlign: "right", fontSize: 8.5 }}>{pct(d.score)}</Text>
              </View>
            ))}
          </View>
          {model.domains.map((d) => {
            const gaps = model.questions.filter((q) => q.domain === d.domain && model.platformOf(q) === d.platform && !["yes", "na"].includes(model.answers[q.id] ?? ""));
            if (!gaps.length) return null;
            return (
              <View key={`${d.platform}:${d.domain}`}>
                <Text style={s.h2} minPresenceAhead={60}>{d.name}</Text>
                {gaps.map((q) => {
                  const lic = model.licenceGap(q);
                  return (
                    <View key={q.id} style={{ marginBottom: 8, paddingBottom: 6, borderBottomWidth: 0.5, borderColor: line }}>
                      <View wrap={false}>
                        <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 2 }}>
                          <Text style={{ fontSize: 7, color: severityColors[q.severity], fontWeight: 700, textTransform: "uppercase" }}>{q.severity}</Text>
                          <Text style={s.small}>{q.id} · Answer: {answerText(model.answers[q.id])} · Effort {q.effort}</Text>
                        </View>
                        <Text style={{ fontWeight: 600, marginBottom: 2 }}>{q.question}</Text>
                        <Text style={{ fontSize: 8.5, color: muted, marginBottom: 2 }}>{q.why}</Text>
                        <Text style={{ fontSize: 8.5 }}><Text style={{ fontWeight: 600 }}>Recommendation: </Text>{q.remediation}</Text>
                        {lic.length > 0 && <Text style={{ fontSize: 8, color: "#7a5200", marginTop: 2 }}>Licence: needs {lic.join(", ")}.</Text>}
                      </View>
                      {/* Notes can be long, so they sit outside the unbreakable block and may run across a page break. */}
                      {a.notes[q.id] && <Text style={{ fontSize: 8, marginTop: 2, fontStyle: "italic" }}>Note: {a.notes[q.id]}</Text>}
                      {a.evidence?.[q.id] && (
                        <Text style={{ fontSize: 8, marginTop: 2, color: muted }}>
                          Scan evidence ({a.evidence[q.id].source}, {stampText(new Date(a.evidence[q.id].scannedAt))}):{" "}
                          {a.evidence[q.id].checks.slice(0, 6).map((c) => `${c.setting || c.id} – ${c.status}`).join("; ")}
                          {a.evidence[q.id].checks.length > 6 ? `; +${a.evidence[q.id].checks.length - 6} more` : ""}
                        </Text>
                      )}
                      <Text style={{ ...s.small, marginTop: 2 }}>
                        {[...q.refs.map((r) => `${model.frameworkName(r.framework)} ${r.ref}`), ...q.e8.map((t) => `E8 ${t.strategy} ML${t.level}`)].join(" · ")}
                      </Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </Section>

        {/* Not applicable */}
        {model.notApplicable.length > 0 && (
          <Section s={s} title="Controls marked not applicable" lead="Controls the organisation answered N/A, with the reason it gave. They are left out of scoring, so check each reason holds: a wrong N/A hides a real gap.">
            <Table
              {...tableProps}
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
        )}

        {/* Roadmap */}
        <Section s={s} title="Remediation roadmap" lead="Gaps ranked by how much risk they remove across your crown jewels per unit of effort. Critical gaps that can be fixed with small or medium effort are brought into the first 30 days.">
          {(["0–30 days", "31–60 days", "61–90 days"] as const).map((phase) => {
            const items = model.roadmap.filter((r) => r.phase === phase);
            if (!items.length) return null;
            return (
              <View key={phase}>
                <Text style={s.h2} minPresenceAhead={60}>{phase}</Text>
                <Table
                  {...tableProps}
                  rows={items}
                  columns={[
                    { header: "Action", width: "56%", render: (r) => (
                      <View>
                        <Text style={{ fontWeight: 600 }}>{r.question.remediation.split(/(?<=\.)\s/)[0]}</Text>
                        <Text style={s.small}>{r.question.id} · {r.question.question}</Text>
                      </View>
                    ) },
                    { header: "Severity", width: "11%", render: (r) => <Text style={{ color: severityColors[r.question.severity], fontWeight: 600, textTransform: "capitalize" }}>{r.question.severity}</Text> },
                    { header: "Effort", width: "8%", render: (r) => r.question.effort },
                    { header: "Protects", width: "25%", render: (r) => protects(r.jewels) },
                  ]}
                />
              </View>
            );
          })}
        </Section>

        {/* Frameworks */}
        <Section s={s} title="Framework alignment" lead="How your answers map to the ASD Essential Eight, NIST Cybersecurity Framework 2.0, CIS Benchmarks and the Department of Home Affairs Industry Data Classification Framework (IDCF). These are indicative: they cover only the cloud-platform controls asked in this assessment and are not a formal audit.">
          <Text style={s.h2}>ASD Essential Eight (indicative maturity)</Text>
          <Table
            {...tableProps}
            rows={model.e8}
            columns={[
              { header: "Mitigation strategy", width: "46%", render: (r) => r.title },
              { header: "Indicative level", width: "18%", render: (r) => (r.level === null ? "Not assessed" : `ML${r.level}`) },
              { header: "Asked up to", width: "14%", render: (r) => (r.ceiling ? `ML${r.ceiling}` : "–") },
              { header: "Blocking gaps", width: "22%", render: (r) => r.blockers.map((q) => q.id).join(", ") || (r.unasked ? `ML${r.unasked} not covered by this assessment` : "–") },
            ]}
          />
          {model.idcf && <IdcfSection model={model} s={s} tableProps={tableProps} />}
          <Text style={s.h2} minPresenceAhead={80}>NIST CSF 2.0 functions</Text>
          {model.csf.map((c) => (
            <View key={c.fn} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <Text style={{ width: 70 }}>{c.fn}</Text>
              <View style={{ flex: 1 }}><Meter value={c.score} color={theme.heading} /></View>
              <Text style={{ width: 30, textAlign: "right" }}>{pct(c.score)}</Text>
              <Text style={{ ...s.small, width: 90, textAlign: "right" }}>{c.subcategories} {c.subcategories === 1 ? "subcategory" : "subcategories"}</Text>
            </View>
          ))}
          {model.cis.length > 0 && (
            <>
              <Text style={s.h2} minPresenceAhead={80}>CIS Benchmark recommendations</Text>
              <Text style={{ ...s.small, marginBottom: 6 }}>Recommendation numbers and titles only. Refer to the CIS Benchmark for audit and remediation procedures.</Text>
              <Table
                {...tableProps}
                rows={model.cis}
                columns={[
                  { header: "Benchmark", width: "16%", render: (r) => model.frameworkName(r.framework) },
                  { header: "Rec.", width: "10%", render: (r) => r.ref },
                  { header: "Title", width: "52%", render: (r) => r.title ?? "" },
                  { header: "Status", width: "22%", render: (r) => r.status },
                ]}
              />
            </>
          )}
        </Section>

        {model.soc && <SocSection model={model} s={s} tableProps={tableProps} />}

        {/* Methodology */}
        <Section s={s} title="Method and limitations">
          {[
            "This is a self-assessment. Answers were provided by the organisation and have not been independently verified. Treat it as a structured starting point for a security conversation, not as an audit or certification.",
            "Questions are drawn from current Microsoft and Google security guidance and mapped to CIS Benchmarks, the ASD Essential Eight Maturity Model, NIST CSF 2.0 and the Department of Home Affairs Industry Data Classification Framework. Each question cites its sources in the references section.",
            "Answers score Yes = 1, Partial = 0.5, No = 0. Unknown and unanswered questions also score 0, so uncertainty is never counted as protection. N/A questions are excluded. Questions are weighted by severity: critical 4, high 3, medium 2, low 1.",
            "Likelihood (1–5) is 1 + 4 × the weighted gap ratio of the questions relevant to a crown jewel, plus 0.5 for each recorded exposure, rounded. If any critical control is not in place, likelihood is at least 3. Impact (1–5) is the highest confidentiality, integrity or availability rating, plus one for regulated or highly confidential data, capped at 5.",
            "Risk bands: 1–4 Low, 5–9 Medium, 10–19 High, 20–25 Extreme.",
            "Where an automated scan was imported, its results pre-filled answers only when its checks were decisive (all pass = Yes, all fail = No, mixed = Partial). The assessor reviewed and could change every answer; scan evidence is shown against each finding.",
            "Essential Eight levels are indicative. A level is reached only when every question at that level and below is answered Yes (or N/A). Strategies outside the scope of a cloud collaboration platform, or levels not asked, are reported as not assessed.",
            "IDCF alignment is indicative. The IDCF is voluntary, has no compliance, certification or assurance process, and leaves the choice of controls to the organisation. The cyber part of each Data Security Level is read from the indicative Essential Eight results: Maturity Level 1 for DSL-2, 2 for DSL-3 and 3 for DSL-4. The authorised-person and device parts are read from the questions mapped to each level, and whole-system and data-movement questions count at every level. A level shows gaps when any mapped question at or below it is not answered Yes, and is shown as not verified when no question maps to that level's own requirements. Each crown jewel's check uses only the questions that apply to it, with the tenant-wide Essential Eight result for the cyber part. Premises security, personnel vetting, training and data residency are not assessed. The organisation chose the Data Security Levels recorded for its crown jewels; crownguard does not assign them.",
            ...(model.soc
              ? [
                  "The SOC maturity section is an indicative self-assessment structured on the SOC-CMM® v2.4 model (5 domains, 27 aspects). Each aspect has one maturity question rated 0–5 against crownguard's own level descriptions, and each technology and service aspect also has a capability question rated 0–3. Unknown and unanswered questions score 0. An aspect's maturity is the mean of its maturity ratings and, for technology and services, its capability the mean of its capability ratings; the two are never combined. A domain scores the unweighted mean of its in-scope aspects, and the indicative overall is the mean of the assessed domains (SOC-CMM itself reports no single score). Level names use the whole-number part of the score, so 2.7 is level 2 and 3.0 is level 3. Targets default to SOC-CMM's: maturity 3 and capability 2.",
                  "SOC results are self-ratings from far fewer questions than SOC-CMM's own tool. They are not SOC-CMM maturity or capability scores, are not comparable with SOC-CMM benchmarks or certification, and don't affect the crown-jewel risk ratings.",
                ]
              : []),
            `crownguard is independent open-source software and is not affiliated with or endorsed by Microsoft, Google, CIS, ASD, NIST, the Department of Home Affairs, CSIRO${model.soc ? " or SOC-CMM" : ""}. Product names are trademarks of their owners.`,
          ].map((t) => <Text key={t} style={s.p}>{t}</Text>)}
        </Section>

        <Section s={s} title="References" lead="Guidance consulted for the questions in this report. Retrieved dates show when each source was last checked.">
          {model.idcf && (
            <Text style={{ ...s.small, marginBottom: 8 }}>
              Contains material adapted from the Industry Data Classification Framework, © Commonwealth of Australia 2026 and © Commonwealth Scientific and
              Industrial Research Organisation (CSIRO) 2026, licensed under CC BY 4.0 (creativecommons.org/licenses/by/4.0), and from “IDCF: A guide to system
              security”, Australian Government Department of Home Affairs, CC BY 3.0 AU. Summaries are crownguard&apos;s own and do not imply endorsement.
            </Text>
          )}
          {model.sources.map((src) => (
            <View key={src.id} wrap={false} style={{ marginBottom: 5 }}>
              <Text style={{ fontSize: 8.5 }}>
                <Text style={{ fontWeight: 600 }}>{src.publisher}.</Text> {sentence(src.title)} Retrieved {src.retrieved}.
              </Text>
              <Link src={src.url} style={{ fontSize: 7.5, color: theme.heading }}>{src.url.length > 110 ? `${src.url.slice(0, 108)}…` : src.url}</Link>
            </View>
          ))}
        </Section>
      </Page>
    </Document>
  );
}

function Heatmap({ model }: { model: ReportModel }) {
  const size = 26;
  return (
    <View>
      {[5, 4, 3, 2, 1].map((impact) => (
        <View key={impact} style={{ flexDirection: "row", gap: 2, marginBottom: 2, alignItems: "center" }}>
          <Text style={{ width: 10, fontSize: 7, color: muted, textAlign: "right", marginRight: 3 }}>{impact}</Text>
          {[1, 2, 3, 4, 5].map((likelihood) => {
            const n = model.risks.filter((r) => r.impact === impact && r.likelihood === likelihood).length;
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
        {[1, 2, 3, 4, 5].map((l) => <Text key={l} style={{ width: size, textAlign: "center", fontSize: 7, color: muted }}>{l}</Text>)}
      </View>
      <Text style={{ fontSize: 7, color: muted, marginLeft: 15, marginTop: 2 }}>Likelihood → (rows: impact)</Text>
    </View>
  );
}

const providerLine: Record<keyof typeof socProviders, string> = {
  "in-house": "The organisation runs its security operations in house.",
  outsourced: "The organisation's security operations are run by a managed provider (MSSP or MDR).",
  hybrid: "The organisation's security operations are run partly in house and partly by a provider.",
  none: "The organisation reported that it doesn't have a SOC.",
};

/** Five-axis radar of domain maturity (0-5) against target. Capability is left off: it uses a different scale. */
function SocRadar({ result, color, accent }: { result: SocResult; color: string; accent: string }) {
  const size = 210;
  const c = { x: size / 2, y: 104 };
  const R = 64;
  const n = result.domains.length;
  const point = (i: number, v: number) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: c.x + R * (v / 5) * Math.cos(angle), y: c.y + R * (v / 5) * Math.sin(angle) };
  };
  const shape = (values: (number | null)[]) =>
    values
      .flatMap((v, i) => (v === null ? [] : [point(i, v)]))
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
  const assessed = result.domains.filter((d) => d.maturity !== null).length;
  return (
    <View style={{ width: size, height: 200, position: "relative" }}>
      <Svg width={size} height={200}>
        {[1, 2, 3, 4, 5].map((ring) => (
          <Polygon key={ring} points={shape(result.domains.map(() => ring))} fill="none" stroke={line} strokeWidth={ring === 5 ? 0.8 : 0.5} />
        ))}
        {result.domains.map((d, i) => {
          const end = point(i, 5);
          // A domain with every aspect out of scope isn't plotted: its axis is dashed instead of reading as 0.
          return <Line key={d.id} x1={c.x} y1={c.y} x2={end.x} y2={end.y} stroke={line} strokeWidth={0.5} {...(d.maturity === null ? { strokeDasharray: "2,2" } : {})} />;
        })}
        <Polygon points={shape(result.domains.map((d) => d.target.maturity))} fill="none" stroke={accent} strokeWidth={1} strokeDasharray="3,2" />
        {assessed > 1 && <Polygon points={shape(result.domains.map((d) => d.maturity))} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.2} />}
        {result.domains.map((d, i) => {
          if (d.maturity === null) return null;
          const p = point(i, d.maturity);
          return <Circle key={d.id} cx={p.x} cy={p.y} r={1.8} fill={color} />;
        })}
      </Svg>
      {result.domains.map((d, i) => {
        const p = point(i, 6.3);
        return (
          <View key={d.id} style={{ position: "absolute", left: p.x - 40, top: p.y - 9, width: 80 }}>
            <Text style={{ fontSize: 7.5, fontWeight: 600, textAlign: "center" }}>{d.name}</Text>
            <Text style={{ fontSize: 7, color: muted, textAlign: "center" }}>{d.maturity === null ? "not assessed" : d.maturity.toFixed(1)}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Optional SOC maturity results, reported apart from crown-jewel risk, with the CC BY-SA attribution. */
function SocSection({ model, s, tableProps }: { model: ReportModel; s: Styles; tableProps: { headerBg: string; zebra: string } }) {
  const { model: soc, questions, result, provider, notes, source, licence } = model.soc!;
  const theme = model.theme;
  // Notes not already shown beside a priority or capability gap, in question order.
  const shown = new Set([...result.priorities.slice(0, 8), ...result.capabilityGaps].map((p) => p.question.id));
  const otherNotes = questions.filter((q) => notes[q.id]?.trim() && !shown.has(q.id)).map((q) => [q.id, notes[q.id].trim()] as const);
  const aspectName = (id: string) => soc.domains.flatMap((d) => d.aspects).find((a) => a.id === id)?.name ?? id;
  const one = (n: number | null) => (n === null ? "–" : n.toFixed(1));
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const maturityName = (n: number) => levelFor(soc.scales.maturity, n).name;
  const assessed = result.domains.filter((d) => d.maturity !== null);
  const onTarget = assessed.filter((d) => d.maturity! >= d.target.maturity).length;
  const aspects = soc.domains.reduce((n, d) => n + d.aspects.length, 0);
  return (
    <Section
      s={s}
      title="SOC maturity (indicative)"
      lead={`An indicative self-assessment of the organisation's security operations, rated 0–5 for each of the ${aspects} aspects in the ${soc.domains.length} domains of the SOC-CMM® v2.4 model, with a 0–3 capability rating for technology and services. It is separate from the crown-jewel risk ratings and doesn't change them.`}
    >
      {provider && <Text style={s.p}>{providerLine[provider]}</Text>}
      <View style={{ flexDirection: "row", gap: 16, alignItems: "center", marginTop: 4 }}>
        <SocRadar result={result} color={theme.heading} accent={theme.accent} />
        <View style={{ flex: 1, gap: 8 }}>
          {[
            ["Indicative overall", result.overall === null ? "–" : `${one(result.overall)} / 5`, `Mean of the domains; target ${one(result.overallTarget)}`],
            ["Domains at or above target", `${onTarget} of ${assessed.length}`, assessed.length < result.domains.length ? `${result.domains.length - assessed.length} left out of scoring` : "maturity, against each domain's target"],
            ["Questions answered", `${result.answered} of ${result.total}`, result.unknown ? `${result.unknown} unknown, scored 0` : "none unknown"],
          ].map(([label, value, hint]) => (
            <View key={label} style={{ backgroundColor: theme.tint, borderRadius: 4, padding: 8 }}>
              <Text style={{ ...s.small, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
              <Text style={{ fontSize: 17, fontWeight: 700, color: theme.heading, marginTop: 1 }}>{value}</Text>
              <Text style={s.small}>{hint}</Text>
            </View>
          ))}
        </View>
      </View>
      <Text style={{ ...s.small, marginBottom: 8 }}>Solid shape: maturity by domain. Dashed line: target. Rings mark levels 1 to 5.</Text>

      <Table
        {...tableProps}
        rows={result.domains}
        columns={[
          { header: "Domain", width: "16%", render: (d) => <Text style={{ fontWeight: 600 }}>{d.name}</Text> },
          { header: "Maturity", width: "13%", render: (d) => (d.maturity === null ? "Not assessed" : `${one(d.maturity)} / 5`) },
          { header: "Level", width: "19%", render: (d) => (d.maturity === null ? "–" : maturityName(d.maturity)) },
          { header: "Target", width: "9%", render: (d) => one(d.target.maturity) },
          // From the rounded figures beside it, so the row adds up.
          { header: "Gap", width: "8%", render: (d) => (d.maturity === null ? "–" : one(Math.max(0, round1(d.target.maturity) - round1(d.maturity)))) },
          { header: "Capability", width: "22%", render: (d) => (d.target.capability === undefined ? "–" : d.capability === null ? "Not assessed" : `${one(d.capability)} / 3 (target ${one(d.target.capability)})`) },
          { header: "Aspects", width: "13%", render: (d) => `${d.aspects.filter((a) => a.inScope).length} of ${d.aspects.length} scored` },
        ]}
      />

      <Text style={s.h2} minPresenceAhead={80}>Aspect profile</Text>
      <Text style={{ ...s.small, marginBottom: 6 }}>Maturity 0–5 for each aspect; the tick marks the domain target. Capability 0–3 is shown for technology and services.</Text>
      {result.domains.map((d) => (
        <View key={d.id} wrap={false} style={{ marginBottom: 8 }}>
          <Text style={{ ...s.h3, color: theme.heading }}>{d.name}</Text>
          {d.aspects.map((a) => (
            <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <Text style={{ width: 134, fontSize: 8.5 }}>{a.name}</Text>
              <View style={{ flex: 1 }}>
                {a.inScope ? <Meter value={(a.maturity ?? 0) / 5} color={theme.heading} marker={d.target.maturity / 5} /> : <Text style={s.small}>Left out of scoring</Text>}
              </View>
              <Text style={{ width: 24, textAlign: "right", fontSize: 8.5 }}>{a.inScope ? one(a.maturity) : "–"}</Text>
              <Text style={{ width: 62, textAlign: "right", fontSize: 7.5, color: muted }}>{a.capability === null ? "" : `capability ${one(a.capability)}`}</Text>
              {(() => {
                const below = a.inScope && a.maturity! < d.target.maturity;
                const capBelow = a.inScope && d.target.capability !== undefined && a.capability !== null && a.capability < d.target.capability;
                return (
                  <Text style={{ width: 84, fontSize: 7.5, color: !a.inScope ? muted : below || capBelow ? "#8a3200" : good }}>
                    {!a.inScope ? "Out of scope" : below ? "Below target" : capBelow ? "Capability below target" : "At or above target"}
                    {a.unknown ? " · unknown" : ""}
                  </Text>
                );
              })()}
            </View>
          ))}
        </View>
      ))}

      {result.priorities.length > 0 && (
        <>
          <Text style={s.h2} minPresenceAhead={80}>Priorities to reach target</Text>
          <Text style={{ ...s.small, marginBottom: 6 }}>
            Aspects furthest below their domain&apos;s maturity target, largest gap first; equal gaps are listed in domain order (business to services).
          </Text>
          {result.priorities.slice(0, 8).map((p, i) => (
            <View key={p.aspect.id} style={{ marginBottom: 6 }}>
              <View wrap={false} style={{ flexDirection: "row", gap: 6 }}>
                <Text style={{ width: 12, fontWeight: 700, color: theme.heading }}>{i + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: 600 }}>
                    {p.aspect.name} <Text style={{ fontWeight: 400, color: muted }}>({p.domain}) · now {one(p.score)} {maturityName(p.score)}, target {one(p.target)}{p.rating === "unknown" ? " · answered Unknown" : ""}</Text>
                  </Text>
                  {p.next && (
                    <Text style={{ fontSize: 8.5, marginTop: 1, lineHeight: 1.35 }}>
                      <Text style={{ fontWeight: 600 }}>Next level ({p.next.level} {p.next.name}): </Text>
                      {p.next.description}
                    </Text>
                  )}
                </View>
              </View>
              {/* Notes can be long, so they sit outside the unbreakable block and may run across a page break. */}
              {notes[p.question.id]?.trim() && <Text style={{ fontSize: 8, marginTop: 1, marginLeft: 18, fontStyle: "italic", lineHeight: 1.35 }}>Note: {notes[p.question.id].trim()}</Text>}
            </View>
          ))}
          {result.priorities.length > 8 && <Text style={s.small}>+ {result.priorities.length - 8} more aspects below target, shown in the aspect profile.</Text>}
        </>
      )}
      {result.capabilityGaps.length > 0 && (
        <>
          <Text style={{ ...s.h3, color: theme.heading, marginTop: 8 }} minPresenceAhead={60}>Capability gaps</Text>
          {result.capabilityGaps.map((p) => (
            <View key={p.aspect.id} style={{ marginBottom: 4 }}>
              <Text wrap={false} style={{ fontSize: 8.5, lineHeight: 1.35 }}>
                <Text style={{ fontWeight: 600 }}>{p.aspect.name}</Text>
                <Text style={{ color: muted }}> ({p.domain}) · capability {one(p.score)} of 3, target {one(p.target)}. </Text>
                {p.next && `Next: ${p.next.description}`}
              </Text>
              {notes[p.question.id]?.trim() && <Text style={{ fontSize: 8, fontStyle: "italic", lineHeight: 1.35 }}>Note: {notes[p.question.id].trim()}</Text>}
            </View>
          ))}
        </>
      )}

      {otherNotes.length > 0 && (
        <>
          <Text style={{ ...s.h3, color: theme.heading, marginTop: 8 }} minPresenceAhead={40}>Assessor notes</Text>
          {otherNotes.map(([id, note]) => {
            const q = questions.find((x) => x.id === id)!;
            return (
              <Text key={id} style={{ fontSize: 8.5, marginBottom: 3, lineHeight: 1.35 }}>
                <Text style={{ fontWeight: 600 }}>{aspectName(q.aspect)}</Text>
                <Text style={{ color: muted }}> ({q.kind}): </Text>
                {note}
              </Text>
            );
          })}
        </>
      )}

      <View wrap={false} style={{ marginTop: 12, borderWidth: 0.5, borderColor: line, borderRadius: 3, padding: 8 }}>
        <Text style={{ ...s.small, lineHeight: 1.4 }}>{soc.attribution}</Text>
        {source && (
          <Text style={{ ...s.small, marginTop: 3 }}>
            Source: <Link src={source.url} style={{ color: theme.heading }}>{source.url}</Link>
          </Text>
        )}
        {licence && (
          <Text style={s.small}>
            Licence: <Link src={licence.url} style={{ color: theme.heading }}>{licence.url}</Link>
          </Text>
        )}
        <Text style={{ ...s.small, marginTop: 3 }}>The protective marking applies to this organisation&apos;s answers and results, not to the CC BY-SA question text.</Text>
      </View>
    </Section>
  );
}

const idcfCellText = (c: IdcfCell) =>
  c.status === "gaps"
    ? `Gaps: ${c.gaps.map((q) => q.id).join(", ")}${c.notVerified.length ? `. Not verified: ${notVerifiedText(c.notVerified)}` : ""}`
    : c.status === "not-verified"
      ? `Not verified: ${notVerifiedText(c.notVerified)}`
      : c.status === "clear"
        ? "No gaps found in the questions asked"
        : "Not assessed";

/** IDCF Data Security Levels: what the answers say about each level's physical, cyber and authorised-person parts. */
function IdcfSection({ model, s, tableProps }: { model: ReportModel; s: Styles; tableProps: { headerBg: string; zebra: string } }) {
  const idcf = model.idcf!;
  return (
    <>
      <Text style={s.h2} minPresenceAhead={80}>IDCF Data Security Levels (indicative)</Text>
      <Text style={s.p}>
        The Industry Data Classification Framework (IDCF), published by the Department of Home Affairs in 2026, gives each item of data one of six Data
        Security Levels, from DSL-0 to DSL-5+. Each level states the protection the data needs against physical, cyber and authorised-person events. The
        IDCF does not prescribe controls. It treats cyber controls equivalent to Essential Eight Maturity Level 1, 2 or 3 as meeting the cyber part of DSL-2,
        DSL-3 or DSL-4, and names Microsoft&apos;s Essential Eight guidance for Microsoft 365 and the CIS Google Workspace Benchmark for Google Workspace. The
        tables show, for each platform and level, whether the questions asked found gaps. Premises security, personnel vetting, training and, for
        DSL-4, data residency and jurisdiction are largely outside a cloud configuration review, so no level is shown as met.
      </Text>
      {idcf.platforms.map((p) => (
        <View key={p.id} style={{ marginBottom: 8 }}>
          <Text style={{ ...s.h3, marginTop: 4 }}>{p.name}</Text>
          <Table
            {...tableProps}
            rows={p.rows}
            columns={[
              { header: "Level", width: "10%", render: (r) => <Text style={{ fontWeight: 600 }}>{`DSL-${r.level}`}</Text> },
              { header: "Physical (devices)", width: "26%", render: (r) => idcfCellText(r.physical) },
              { header: "Cyber (Essential Eight)", width: "38%", render: (r) => idcfCellText(r.cyber) },
              { header: "Authorised person", width: "26%", render: (r) => idcfCellText(r.person) },
            ]}
          />
          <Text style={{ ...s.small, marginTop: 3 }}>
            <Text style={{ fontWeight: 600 }}>Whole system and data movement (every level from DSL-2): </Text>
            {idcfCellText(p.system)}.
          </Text>
        </View>
      ))}
      <Text style={s.small}>
        Microsoft 365 at Essential Eight Maturity Level 3 &quot;may be&quot; DSL-4 appropriate, by agreement with the data recipient. Devices that cache or sync
        the data are part of the system. The IDCF has no certification or assurance process: a data owner should seek assurance, for example a Statement of
        System Security, before relying on a system for a given level.
      </Text>
      {idcf.jewels.length > 0 && (
        <View style={{ marginTop: 8 }}>
          {idcf.jewels.map((j) => (
            <Text key={j.jewel.id} style={{ ...s.p, fontSize: 8.5 }}>
              {j.text}
            </Text>
          ))}
        </View>
      )}
      {model.assessment.jewels.some((j) => !j.dsl) && idcf.jewels.length > 0 && (
        <Text style={s.small}>Crown jewels without a level are not classified under the IDCF; under the IDCF, unlabelled data is unclassified, not DSL-0.</Text>
      )}
    </>
  );
}

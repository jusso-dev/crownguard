import { Document, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { exposures } from "../content/schema";
import { formatAbn, isValidAbn } from "../engine/abn";
import { bandOf } from "../engine/risk";
import { answerLabels, classifications, regulations, type Answer } from "../engine/types";
import type { ReportModel } from "./model";
import { Badge, bandColors, ink, line, Meter, muted, pct, severityColors, Table } from "./primitives";

const answerText = (a: Answer | undefined) => (a ? answerLabels[a] : "Unanswered");
const protects = (jewels: { name: string }[]) =>
  jewels.length === 0
    ? "the whole environment"
    : jewels.length <= 3
      ? jewels.map((j) => j.name).join(", ")
      : `${jewels.slice(0, 2).map((j) => j.name).join(", ")} and ${jewels.length - 2} more`;
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
          <View style={{ marginTop: 70, alignSelf: "flex-start", backgroundColor: "#ffffff", padding: 12, borderRadius: 4 }}>
            <Image src={a.branding.logoDataUrl} style={{ maxHeight: 64, maxWidth: 220, objectFit: "contain" }} />
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
          <Text style={s.p}>
            {a.org.name} identified {model.risks.length} crown jewel{model.risks.length === 1 ? "" : "s"} across {model.platformNames.join(" and ")} and
            answered {model.questions.length - unknownCount} of {model.questions.length} control questions drawn from vendor security guidance.
            {extreme + high > 0
              ? ` ${extreme + high} crown jewel${extreme + high === 1 ? " is" : "s are"} at high or extreme risk${top ? `, led by “${top.jewel.name}” (${top.band.toLowerCase()}, ${top.score}/25)` : ""}.`
              : " No crown jewel is currently rated high or extreme risk."}
            {unknownCount > 0 ? ` ${unknownCount} control${unknownCount === 1 ? " is" : "s are"} unknown and treated as gaps until confirmed.` : ""}
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 6 }}>
            {[
              ["Control posture", pct(model.posture.score), "Severity-weighted controls in place"],
              ["Answer confidence", pct(model.posture.confidence), "Answers that aren't Unknown"],
              ["High / extreme risks", String(extreme + high), `of ${model.risks.length} crown jewels`],
            ].map(([label, value, hint]) => (
              <View key={label} style={{ flex: 1, backgroundColor: theme.tint, borderRadius: 4, padding: 10 }}>
                <Text style={{ ...s.small, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
                <Text style={{ fontSize: 22, fontWeight: 700, color: theme.heading, marginTop: 2 }}>{value}</Text>
                <Text style={s.small}>{hint}</Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: "row", gap: 18, marginTop: 6 }}>
            <View>
              <Text style={s.h2}>Risk heatmap</Text>
              <Heatmap model={model} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.h2}>Highest risks</Text>
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
              <Text style={s.h2} minPresenceAhead={90}>Priority actions (next 30 days)</Text>
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
        <Section s={s} title="Crown-jewel register" lead="The systems and information whose compromise would most seriously harm the organisation, as identified during this assessment. Impact ratings use 1 (minimal) to 5 (severe).">
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
              { header: "Classification", width: "14%", render: (r) => classifications[r.jewel.classification] },
              { header: "C / I / A", width: "10%", render: (r) => `${r.jewel.confidentiality} / ${r.jewel.integrity} / ${r.jewel.availability}` },
              { header: "Obligations", width: "18%", render: (r) => r.jewel.regulations.map((x) => regulations[x].split(" (")[0]).join("; ") || "–" },
              { header: "Exposure", width: "20%", render: (r) => r.jewel.exposures.map((x) => exposures[x]).join("; ") || "None recorded" },
              { header: "Supports", width: "14%", render: (r) => r.jewel.businessProcesses || "–" },
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
                    <View key={q.id} wrap={false} style={{ marginBottom: 8, paddingBottom: 6, borderBottomWidth: 0.5, borderColor: line }}>
                      <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginBottom: 2 }}>
                        <Text style={{ fontSize: 7, color: severityColors[q.severity], fontWeight: 700, textTransform: "uppercase" }}>{q.severity}</Text>
                        <Text style={s.small}>{q.id} · Answer: {answerText(model.answers[q.id])} · Effort {q.effort}</Text>
                      </View>
                      <Text style={{ fontWeight: 600, marginBottom: 2 }}>{q.question}</Text>
                      <Text style={{ fontSize: 8.5, color: muted, marginBottom: 2 }}>{q.why}</Text>
                      <Text style={{ fontSize: 8.5 }}><Text style={{ fontWeight: 600 }}>Recommendation: </Text>{q.remediation}</Text>
                      {lic.length > 0 && <Text style={{ fontSize: 8, color: "#7a5200", marginTop: 2 }}>Licence: needs {lic.join(", ")}.</Text>}
                      {a.notes[q.id] && <Text style={{ fontSize: 8, marginTop: 2, fontStyle: "italic" }}>Note: {a.notes[q.id]}</Text>}
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
        <Section s={s} title="Framework alignment" lead="How your answers map to the ASD Essential Eight, NIST Cybersecurity Framework 2.0 and CIS Benchmarks. These are indicative: they cover only the cloud-platform controls asked in this assessment and are not a formal audit.">
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

        {/* Methodology */}
        <Section s={s} title="Method and limitations">
          {[
            "This is a self-assessment. Answers were provided by the organisation and have not been independently verified. Treat it as a structured starting point for a security conversation, not as an audit or certification.",
            "Questions are drawn from current Microsoft and Google security guidance and mapped to CIS Benchmarks, the ASD Essential Eight Maturity Model and NIST CSF 2.0. Each question cites its sources in the references section.",
            "Answers score Yes = 1, Partial = 0.5, No = 0. Unknown and unanswered questions also score 0, so uncertainty is never counted as protection. N/A questions are excluded. Questions are weighted by severity: critical 4, high 3, medium 2, low 1.",
            "Likelihood (1–5) is 1 + 4 × the weighted gap ratio of the questions relevant to a crown jewel, plus 0.5 for each recorded exposure, rounded. If any critical control is not in place, likelihood is at least 3. Impact (1–5) is the highest confidentiality, integrity or availability rating, plus one for regulated or highly confidential data, capped at 5.",
            "Risk bands: 1–4 Low, 5–9 Medium, 10–19 High, 20–25 Extreme.",
            "Essential Eight levels are indicative. A level is reached only when every question at that level and below is answered Yes (or N/A). Strategies outside the scope of a cloud collaboration platform, or levels not asked, are reported as not assessed.",
            "crownguard is independent open-source software and is not affiliated with or endorsed by Microsoft, Google, CIS, ASD or NIST. Product names are trademarks of their owners.",
          ].map((t) => <Text key={t} style={s.p}>{t}</Text>)}
        </Section>

        <Section s={s} title="References" lead="Guidance consulted for the questions in this report. Retrieved dates show when each source was last checked.">
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

import { Text, View } from "@react-pdf/renderer";
import { aiAccess, aiAutonomy, aiCriteria, aiData, aiLifecycles, aiRiskRatings } from "../../format/aiOptions";
import { basisLabel, dayText } from "../../engine/aiExport";
import { aiFieldLabels, KILL_SWITCH_QUESTION } from "../../engine/aiRegister";
import { pct } from "../../engine/percent";
import { Section } from "../layout";
import type { AiRegisterSlice } from "../model";
import { Badge, exampleColors, line, muted, severityColors, StatTiles, Table, themeStatusColors, useTheme, warning, caution } from "../primitives";
import { answerText } from "../../format/vocab";
import { firstSentence, riskScore } from "../text";

const GAPS_SHOWN = 8;

/** The AI use-case register: the register table, then each use case's readiness, with the key dates and caveats. */
export function AiRegisterSection({ register: r }: { register: AiRegisterSlice }) {
  const { theme, s } = useTheme();
  const scopeText = (v: boolean | undefined) => (v === undefined ? "Not checked" : v ? "In scope" : "Not in scope");
  return (
    <Section
      id="ai-register"
      title="AI use-case register"
      lead="The organisation's AI use cases and agents, recorded with the minimum fields in the DTA's Standard for accountability, and an indicative readiness check against the Policy for the responsible use of AI in government and the agentic AI addendum. It's separate from the crown-jewel risk ratings and doesn't change them."
    >
      <Text style={s.p}>{r.model.appliesTo}</Text>
      {r.dateConfirmation && (
        <Text style={s.p}>
          Worked-out dates confirmed by {r.dateConfirmation.by}
          {r.dateConfirmation.on ? ` on ${dayText(r.dateConfirmation.on)}` : ""}.
        </Text>
      )}
      {r.share.due && (
        <Text style={{ ...s.p, fontWeight: r.share.overdue ? 600 : undefined, color: r.share.overdue ? warning : undefined }}>
          Next share with the DTA due {dayText(r.share.due)}, counted from {r.share.basis === "shared" ? "the last share" : "the register's creation"}
          {r.share.overdue ? " — overdue" : r.share.soon ? " (due within 30 days)" : ""}.
        </Text>
      )}
      {r.examples > 0 && (
        <View wrap={false} style={{ backgroundColor: exampleColors.bg, borderRadius: 3, padding: 8, marginBottom: 8 }}>
          <Text style={{ fontSize: 8.5, color: exampleColors.fg, fontWeight: 600 }}>
            {r.examples} of these entries {r.examples === 1 ? "is" : "are"} example data loaded to show how the register works. {r.examples === 1 ? "It's" : "They're"} marked EXAMPLE and {r.examples === 1 ? "isn't a real use case" : "aren't real use cases"}.
          </Text>
        </View>
      )}
      <StatTiles
        tiles={[
          ["Use cases", String(r.entries.length), r.undetermined ? `${r.undetermined} not yet checked for scope` : "all checked for scope"],
          ["In scope", String(r.inScope), `${r.highRisk} rated high inherent risk`],
          ["Open readiness gaps", String(r.openGaps), r.criticalGaps ? `${r.criticalGaps} critical` : "none critical"],
          ["Register fields missing", String(r.missingFields), "across all use cases"],
        ]}
      />

      {r.entries.length > 0 && (
        <Table
          rows={r.entries}
          columns={[
            { header: "Use case", width: "25%", render: (x) => (
              <View>
                <Text style={{ fontWeight: 600 }}>{x.entry.name || "Unnamed use case"}</Text>
                <Text style={s.small}>{[x.entry.reference, x.kind?.name].filter(Boolean).join(" · ")}</Text>
                {x.entry.example && <Badge {...exampleColors}>EXAMPLE</Badge>}
              </View>
            ) },
            { header: "Owner", width: "18%", render: (x) => x.entry.ownerName || "Not recorded" },
            { header: "Stage", width: "9%", render: (x) => (x.entry.lifecycle ? aiLifecycles[x.entry.lifecycle] : "–") },
            { header: "Scope", width: "11%", render: (x) => scopeText(x.inScope) },
            { header: "Inherent / residual", width: "13%", render: (x) => `${x.entry.inherentRisk ? aiRiskRatings[x.entry.inherentRisk] : "–"} / ${x.entry.residualRisk ? aiRiskRatings[x.entry.residualRisk] : "–"}` },
            { header: "Readiness", width: "12%", render: (x) => (x.score === null ? "Not answered" : pct(x.score)) },
            { header: "Gaps", width: "12%", render: (x) => `${x.gaps.length}${x.missing.length ? ` · ${x.missing.length} fields` : ""}` },
          ]}
        />
      )}

      {r.entries.map((x) => (
        <View key={x.entry.id} style={{ borderWidth: 0.5, borderColor: line, borderLeftWidth: 3, borderLeftColor: x.entry.example ? exampleColors.fg : theme.heading, borderRadius: 3, padding: 9, marginTop: 10 }}>
          <View wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <Text style={{ ...s.h3, marginBottom: 0, flex: 1 }}>{x.entry.name || "Unnamed use case"}</Text>
              {x.entry.example && <Badge {...exampleColors}>EXAMPLE</Badge>}
              <Text style={s.small}>Readiness {x.score === null ? "not answered" : pct(x.score)} · {x.answered} of {x.questions.length} answered</Text>
            </View>
            <Text style={s.small}>
              {[
                x.entry.product,
                x.entry.autonomy && aiAutonomy[x.entry.autonomy].label,
                x.entry.access && `Access: ${aiAccess[x.entry.access].label}`,
                x.entry.data.length ? `Data: ${x.entry.data.map((d) => aiData[d]).join(", ")}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {x.entry.criteria.length > 0 && <Text style={s.small}>Appendix C: {x.entry.criteria.map((c) => aiCriteria[c]).join("; ")}</Text>}
            {x.entry.description && <Text style={{ fontSize: 8.5, marginTop: 4, lineHeight: 1.35 }}>{x.entry.description}</Text>}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
              {x.themes.map((t) =>
                t.status === "Not asked" ? null : (
                  <Text key={t.id} style={{ fontSize: 7, paddingVertical: 1.5, paddingHorizontal: 4, borderRadius: 2, ...themeStatusColors[t.status] }}>
                    {t.name}: {t.status}
                  </Text>
                ),
              )}
            </View>
          </View>
          {x.jewels.length > 0 && (
            <Text style={{ fontSize: 8.5, marginTop: 5 }}>
              <Text style={{ fontWeight: 600 }}>Crown jewels it can reach: </Text>
              {x.jewels.map((j) => (j.risk ? `${j.jewel.name} (${j.risk.band.toLowerCase()} risk, ${riskScore(j.risk.score)})` : j.jewel.name)).join("; ")}
            </Text>
          )}
          {x.gaps.length > 0 && (
            <View style={{ marginTop: 5 }}>
              {x.gaps.slice(0, GAPS_SHOWN).map((g) => (
                <View key={g.question.id} wrap={false} style={{ flexDirection: "row", gap: 5, marginBottom: 2 }}>
                  <Text style={{ width: 44, fontSize: 7, color: severityColors[g.question.severity], fontWeight: 600, textTransform: "uppercase", paddingTop: 1 }}>{g.question.severity}</Text>
                  <Text style={{ flex: 1, fontSize: 8.5 }}>
                    {g.question.question} <Text style={{ color: muted }}>({answerText(g.answer)} · {basisLabel(g.question.basis)}) </Text>
                    <Text style={{ fontWeight: 600 }}>Fix: </Text>
                    {firstSentence(g.question.remediation)}
                  </Text>
                </View>
              ))}
              {x.gaps.length > GAPS_SHOWN && <Text style={s.small}>+ {x.gaps.length - GAPS_SHOWN} further gaps in the register export.</Text>}
            </View>
          )}
          {x.missing.length > 0 && (
            <Text style={{ fontSize: 8, marginTop: 4, color: caution }}>Register fields still to fill in: {x.missing.map((f) => aiFieldLabels[f]).join("; ")}.</Text>
          )}
          {x.flags.map((f) => (
            <Text key={f} style={{ fontSize: 8, marginTop: 3, color: warning }}>{f}</Text>
          ))}
          {Object.entries(x.entry.notes)
            .filter(([, n]) => n.trim())
            .map(([id, n]) => (
              <Text key={id} style={{ fontSize: 8, marginTop: 2, fontStyle: "italic", lineHeight: 1.35 }}>
                {id === KILL_SWITCH_QUESTION ? `Kill-switch worksheet (${id})` : `Note (${id})`}: {n.trim()}
              </Text>
            ))}
          {x.entry.jewels.some((id) => !x.jewels.some((j) => j.jewel.id === id)) && <Text style={s.small}>Some linked crown jewels have since been removed.</Text>}
        </View>
      ))}

      <Text style={s.h2} minPresenceAhead={80}>Key dates</Text>
      {r.model.dates.map((d) => (
        <View key={d.text} wrap={false} style={{ flexDirection: "row", gap: 8, marginBottom: 3 }}>
          <Text style={{ width: 92, fontSize: 8.5, fontWeight: 600 }}>{d.date ? `${dayText(d.date)}${d.derived ? "*" : ""}` : "Ongoing"}</Text>
          <Text style={{ flex: 1, fontSize: 8.5, lineHeight: 1.35 }}>{d.text}</Text>
        </View>
      ))}
      {r.model.dates.some((d) => d.derived) && <Text style={s.small}>* Worked out from the policy&apos;s wording, not printed in it.</Text>}

      <Text style={s.h2} minPresenceAhead={80}>Where the sources are unclear</Text>
      {r.model.caveats.map((c) => (
        <Text key={c.text} style={{ ...s.p, fontSize: 8.5 }}>{c.text}</Text>
      ))}

      <View wrap={false} style={{ marginTop: 8, borderWidth: 0.5, borderColor: line, borderRadius: 3, padding: 8 }}>
        <Text style={{ ...s.small, lineHeight: 1.4 }}>{r.model.attribution}</Text>
      </View>
    </Section>
  );
}

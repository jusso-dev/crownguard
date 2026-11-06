import { Text, View } from "@react-pdf/renderer";
import { gapLabels, ratingLabels, type DomainResult, type EssentialsRating } from "../../engine/essentials";
import { Section } from "../layout";
import type { ReportModel } from "../model";
import { Badge, essentialsColors, Table, useTheme } from "../primitives";

function RatingBadge({ rating }: { rating: EssentialsRating }) {
  return <Badge {...essentialsColors[rating]}>{ratingLabels[rating]}</Badge>;
}

const phaseText = (d: DomainResult) => (d.type === "capability" ? "All phases" : `Phase ${d.phases.join(", ")}`);

export function EssentialsSection({ essentials: e }: { essentials: NonNullable<ReportModel["essentials"]> }) {
  const { s } = useTheme();
  const idText = (id: string) => (e.framework.provisional ? `${id} (provisional ID)` : id);
  return (
    <Section
      id="essentials"
      title="ASD Essentials (indicative)"
      lead={`Indicative effectiveness ratings against ASD's ${e.framework.name}, by priority phase and domain. Shown beside the Essential Eight, not instead of it: nothing here is calculated from Essential Eight maturity levels, and this is not a formal Essentials assessment.`}
    >
      <Text style={s.h2}>Summary by phase and domain</Text>
      <Text style={{ ...s.small, marginBottom: 6 }}>
        Phases are ASD&apos;s order for doing the work, not a rating. Capability domains run across every phase. Not assessed principles are counted
        separately and left out of the percentage.
      </Text>
      <Table
        rows={e.domains}
        columns={[
          { header: "Domain", width: "28%", render: (d) => <Text style={{ fontWeight: 600 }}>{d.name}</Text> },
          { header: "Phase", width: "14%", render: phaseText },
          { header: "Effective", width: "12%", render: (d) => (d.percentage === null ? "Not assessed" : `${d.percentage}%`) },
          { header: "Fully", width: "11%", render: (d) => String(d.counts["fully-effective"]) },
          { header: "Partially", width: "11%", render: (d) => String(d.counts["partially-effective"]) },
          { header: "Not effective", width: "12%", render: (d) => String(d.counts["not-effective"]) },
          { header: "Not assessed", width: "12%", render: (d) => String(d.counts["not-assessed"]) },
        ]}
      />
      {e.domains.map((d) => (
        <View key={d.id}>
          <Text style={s.h2} minPresenceAhead={80}>
            {d.name} ({phaseText(d).toLowerCase()})
          </Text>
          <Table
            rows={d.principles.flatMap((p) => p.actions.flatMap((a) => (a.rating === null ? [] : [{ p, a, rating: a.rating }])).map((x, i) => ({ ...x, first: i === 0 })))}
            columns={[
              {
                header: "Principle",
                width: "24%",
                render: ({ p, first }) =>
                  first ? (
                    <View style={{ gap: 2 }}>
                      <Text style={{ fontWeight: 600 }}>{p.id} {p.name}</Text>
                      <RatingBadge rating={p.rating} />
                    </View>
                  ) : (
                    ""
                  ),
              },
              { header: "Action", width: "16%", render: ({ a }) => idText(a.id) },
              { header: "What it asks (shortened)", width: "30%", render: ({ a }) => a.title },
              { header: "Rating", width: "14%", render: ({ rating }) => <RatingBadge rating={rating} /> },
              { header: "Questions", width: "16%", render: ({ a }) => a.evidence.map((x) => x.question.id).join(", ") || "None asked" },
            ]}
          />
        </View>
      ))}
      <Text style={s.h2} minPresenceAhead={80}>Essential Eight to Essentials gap view</Text>
      <Text style={{ ...s.small, marginBottom: 6 }}>
        Gap analysis finding, not a rating. ASD&apos;s transition guide maps each Essential Eight strategy to Essentials principles; the class here comes
        from each principle&apos;s own Essentials results above, never from a maturity level.
      </Text>
      <Table
        rows={e.gaps}
        columns={[
          { header: "Principle", width: "38%", render: (g) => `${g.principle} ${g.name}` },
          { header: "Essential Eight strategies", width: "36%", render: (g) => g.strategyTitles.join(", ") || "No Essential Eight equivalent" },
          { header: "Gap analysis finding", width: "26%", render: (g) => (g.gap ? gapLabels[g.gap] : "Not enough answers") },
        ]}
      />
    </Section>
  );
}

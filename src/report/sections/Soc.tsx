import { Circle, Line, Link, Polygon, Svg, Text, View } from "@react-pdf/renderer";
import { levelFor, type SocResult } from "../../engine/soc";
import type { SocProvider } from "../../format/vocab";
import { Section } from "../layout";
import { SOC_PRIORITIES_SHOWN, type ReportModel } from "../model";
import { good, line, Meter, muted, StatTiles, Table, useTheme, warning } from "../primitives";

const providerLine: Record<SocProvider, string> = {
  "in-house": "The organisation runs its security operations in house.",
  outsourced: "The organisation's security operations are run by a managed provider (MSSP or MDR).",
  hybrid: "The organisation's security operations are run partly in house and partly by a provider.",
  none: "The organisation reported that it doesn't have a SOC.",
};

const one = (n: number | null) => (n === null ? "–" : n.toFixed(1));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Optional SOC maturity results, reported apart from crown-jewel risk, with the CC BY-SA attribution. */
export function SocSection({ soc }: { soc: NonNullable<ReportModel["soc"]> }) {
  const { theme, s } = useTheme();
  const { model, result, notes } = soc;
  const maturityName = (n: number) => levelFor(model.scales.maturity, n).name;
  return (
    <Section
      id="soc"
      title="SOC maturity (indicative)"
      lead={`An indicative self-assessment of the organisation's security operations, rated 0–5 for each of the ${soc.aspects} aspects in the ${model.domains.length} domains of the SOC-CMM® v${soc.version} model, with a 0–3 capability rating for technology and services. It is separate from the crown-jewel risk ratings and doesn't change them.`}
    >
      {soc.provider && <Text style={s.p}>{providerLine[soc.provider]}</Text>}
      <View style={{ flexDirection: "row", gap: 16, alignItems: "center", marginTop: 4 }}>
        <SocRadar result={result} color={theme.heading} accent={theme.accent} />
        <StatTiles
          column
          tiles={[
            ["Indicative overall", result.overall === null ? "–" : `${one(result.overall)} / 5`, `Mean of the domains; target ${one(result.overallTarget)}`],
            ["Domains at or above target", `${soc.onTarget} of ${soc.assessed}`, soc.assessed < result.domains.length ? `${result.domains.length - soc.assessed} left out of scoring` : "maturity, against each domain's target"],
            ["Questions answered", `${result.answered} of ${result.total}`, result.unknown ? `${result.unknown} unknown, scored 0` : "none unknown"],
          ]}
        />
      </View>
      <Text style={{ ...s.small, marginBottom: 8 }}>Solid shape: maturity by domain. Dashed line: target. Rings mark levels 1 to 5.</Text>

      <Table
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
          {d.aspects.map((a) => {
            const below = a.inScope && a.maturity! < d.target.maturity;
            const capBelow = a.inScope && d.target.capability !== undefined && a.capability !== null && a.capability < d.target.capability;
            return (
              <View key={a.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <Text style={{ width: 134, fontSize: 8.5 }}>{a.name}</Text>
                <View style={{ flex: 1 }}>
                  {a.inScope ? <Meter value={(a.maturity ?? 0) / 5} color={theme.heading} marker={d.target.maturity / 5} /> : <Text style={s.small}>Left out of scoring</Text>}
                </View>
                <Text style={{ width: 24, textAlign: "right", fontSize: 8.5 }}>{a.inScope ? one(a.maturity) : "–"}</Text>
                <Text style={{ width: 62, textAlign: "right", fontSize: 7.5, color: muted }}>{a.capability === null ? "" : `capability ${one(a.capability)}`}</Text>
                <Text style={{ width: 84, fontSize: 7.5, color: !a.inScope ? muted : below || capBelow ? warning : good }}>
                  {!a.inScope ? "Out of scope" : below ? "Below target" : capBelow ? "Capability below target" : "At or above target"}
                  {a.unknown ? " · unknown" : ""}
                </Text>
              </View>
            );
          })}
        </View>
      ))}

      {result.priorities.length > 0 && (
        <>
          <Text style={s.h2} minPresenceAhead={80}>Priorities to reach target</Text>
          <Text style={{ ...s.small, marginBottom: 6 }}>
            Aspects furthest below their domain&apos;s maturity target, largest gap first; equal gaps are listed in domain order (business to services).
          </Text>
          {result.priorities.slice(0, SOC_PRIORITIES_SHOWN).map((p, i) => (
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
              <Note text={notes[p.question.id]} indent />
            </View>
          ))}
          {result.priorities.length > SOC_PRIORITIES_SHOWN && <Text style={s.small}>+ {result.priorities.length - SOC_PRIORITIES_SHOWN} more aspects below target, shown in the aspect profile.</Text>}
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
              <Note text={notes[p.question.id]} />
            </View>
          ))}
        </>
      )}

      {soc.otherNotes.length > 0 && (
        <>
          <Text style={{ ...s.h3, color: theme.heading, marginTop: 8 }} minPresenceAhead={40}>Assessor notes</Text>
          {soc.otherNotes.map((n) => (
            <Text key={n.id} style={{ fontSize: 8.5, marginBottom: 3, lineHeight: 1.35 }}>
              <Text style={{ fontWeight: 600 }}>{n.aspect}</Text>
              <Text style={{ color: muted }}> ({n.kind}): </Text>
              {n.note}
            </Text>
          ))}
        </>
      )}

      <View wrap={false} style={{ marginTop: 12, borderWidth: 0.5, borderColor: line, borderRadius: 3, padding: 8 }}>
        <Text style={{ ...s.small, lineHeight: 1.4 }}>{model.attribution}</Text>
        {soc.source && (
          <Text style={{ ...s.small, marginTop: 3 }}>
            Source: <Link src={soc.source.url} style={{ color: theme.heading }}>{soc.source.url}</Link>
          </Text>
        )}
        {soc.licence && (
          <Text style={s.small}>
            Licence: <Link src={soc.licence.url} style={{ color: theme.heading }}>{soc.licence.url}</Link>
          </Text>
        )}
        <Text style={{ ...s.small, marginTop: 3 }}>The protective marking applies to this organisation&apos;s answers and results, not to the CC BY-SA question text.</Text>
      </View>
    </Section>
  );
}

function Note({ text, indent }: { text: string | undefined; indent?: boolean }) {
  if (!text) return null;
  return <Text style={{ fontSize: 8, fontStyle: "italic", lineHeight: 1.35, ...(indent ? { marginTop: 1, marginLeft: 18 } : {}) }}>Note: {text}</Text>;
}

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

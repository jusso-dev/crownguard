import { Text, View } from "@react-pdf/renderer";
import { notVerifiedText, type IdcfCell } from "../../engine/idcf";
import type { ReportModel } from "../model";
import { Table, useTheme } from "../primitives";

const TITLE = "IDCF Data Security Levels (indicative)";

const cellText = (c: IdcfCell) =>
  c.status === "gaps"
    ? `Gaps: ${c.gaps.map((q) => q.id).join(", ")}${c.notVerified.length ? `. Not verified: ${notVerifiedText(c.notVerified)}` : ""}`
    : c.status === "not-verified"
      ? `Not verified: ${notVerifiedText(c.notVerified)}`
      : c.status === "clear"
        ? "No gaps found in the questions asked"
        : "Not assessed";

/** IDCF Data Security Levels: what the answers say about each level's physical, cyber and authorised-person parts. */
export function IdcfSection({ idcf }: { idcf: NonNullable<ReportModel["idcf"]> }) {
  const { s } = useTheme();
  return (
    <View id="idcf" {...{ bookmark: { title: TITLE, fit: true } }}>
      <Text style={s.h2} minPresenceAhead={80}>{TITLE}</Text>
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
            rows={p.rows}
            columns={[
              { header: "Level", width: "10%", render: (r) => <Text style={{ fontWeight: 600 }}>{`DSL-${r.level}`}</Text> },
              { header: "Physical (devices)", width: "26%", render: (r) => cellText(r.physical) },
              { header: "Cyber (Essential Eight)", width: "38%", render: (r) => cellText(r.cyber) },
              { header: "Authorised person", width: "26%", render: (r) => cellText(r.person) },
            ]}
          />
          <Text style={{ ...s.small, marginTop: 3 }}>
            <Text style={{ fontWeight: 600 }}>Whole system and data movement (every level from DSL-2): </Text>
            {cellText(p.system)}.
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
      {idcf.unclassified && idcf.jewels.length > 0 && (
        <Text style={s.small}>Crown jewels without a level are not classified under the IDCF; under the IDCF, unlabelled data is unclassified, not DSL-0.</Text>
      )}
    </View>
  );
}

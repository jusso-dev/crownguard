import { Link, StyleSheet, Text, View, type Styles } from "@react-pdf/renderer";
import { createContext, useContext, type ReactNode } from "react";
import type { Source } from "../content/schema";
import type { Band } from "../engine/risk";
import type { ThemeStatus } from "../engine/aiRegister";
import type { ReportTheme } from "./model";
import { sentence } from "./text";

export const ink = "#1c2333";
export const muted = "#5b6478";
export const line = "#e2e5eb";
export const good = "#1d6b3f";
/** Text for something to look at: medium risk, a partly met theme, a licence the fix needs. */
export const caution = "#7a5200";
/** Text for something to act on: high risk, a target missed, a share overdue. */
export const warning = "#8a3200";
const danger = "#8c1414";
const zebra = "#fafbfc";

export const bandColors: Record<Band, { bg: string; fg: string }> = {
  Low: { bg: "#d9efe1", fg: "#1d5c36" },
  Medium: { bg: "#fbefc8", fg: caution },
  High: { bg: "#fbd9c4", fg: warning },
  Extreme: { bg: "#f6c9c9", fg: danger },
};

/** ASD Essentials ratings. Not assessed has its own neutral colour so it is never read as a failure. */
export const essentialsColors = {
  "not-assessed": { bg: "#e8eaef", fg: "#3d4556" },
  "not-effective": bandColors.Extreme,
  "partially-effective": bandColors.Medium,
  "fully-effective": bandColors.Low,
} as const;

export const severityColors = {
  critical: danger,
  high: warning,
  medium: caution,
  low: "#4a5568",
};

export const exampleColors = { fg: caution, bg: "#fdf3dc" };

export const themeStatusColors: Record<Exclude<ThemeStatus, "Not asked">, { color: string; backgroundColor: string }> = {
  Met: { color: good, backgroundColor: "#e5f4ea" },
  "Partly met": { color: caution, backgroundColor: exampleColors.bg },
  "Not met": { color: warning, backgroundColor: "#fbe9e2" },
  "Not applicable": { color: muted, backgroundColor: "#f1f3f5" },
};

const makeStyles = (theme: ReportTheme) =>
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

const Theme = createContext<{ theme: ReportTheme; s: ReturnType<typeof makeStyles> } | null>(null);

export function ThemeProvider({ theme, children }: { theme: ReportTheme; children: ReactNode }) {
  return <Theme.Provider value={{ theme, s: makeStyles(theme) }}>{children}</Theme.Provider>;
}

/** The document's colours and text styles. Every component below a `ThemeProvider` reads them here. */
export function useTheme() {
  const t = useContext(Theme);
  if (!t) throw new Error("useTheme needs a ThemeProvider");
  return t;
}

export function Badge({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <Text style={{ backgroundColor: bg, color: fg, fontSize: 7.5, fontWeight: 600, paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 2 }}>
      {children}
    </Text>
  );
}

interface Column<T> {
  header: string;
  width: number | string;
  render: (row: T) => ReactNode;
}

export function Table<T>({
  columns,
  rows,
  repeatHeader,
}: {
  columns: Column<T>[];
  rows: T[];
  /** Repeat the header on each page the table spans. Off by default: fixed headers on every table slow large reports. */
  repeatHeader?: boolean;
}) {
  const { theme } = useTheme();
  const cell: Styles[string] = { paddingVertical: 4, paddingHorizontal: 5 };
  return (
    <View style={{ borderWidth: 0.5, borderColor: line, borderRadius: 3 }}>
      <View fixed={repeatHeader || undefined} style={{ flexDirection: "row", backgroundColor: theme.tint }}>
        {columns.map((c) => (
          <Text key={c.header} style={{ ...cell, width: c.width, fontSize: 7.5, fontWeight: 600, color: muted, textTransform: "uppercase" }}>
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} wrap={false} style={{ flexDirection: "row", backgroundColor: i % 2 ? zebra : "#ffffff", borderTopWidth: 0.5, borderColor: line }}>
          {columns.map((c) => (
            <View key={c.header} style={{ ...cell, width: c.width }}>
              {wrapText(c.render(r))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const wrapText = (n: ReactNode) => (typeof n === "string" || typeof n === "number" ? <Text>{n}</Text> : n);

/** A 0-1 bar; `marker` draws a target tick at that point. */
export function Meter({ value, color, marker }: { value: number | null; color: string; marker?: number }) {
  return (
    <View style={{ height: 5, backgroundColor: line, borderRadius: 2.5 }}>
      <View style={{ height: 5, width: `${Math.round((value ?? 0) * 100)}%`, backgroundColor: color, borderRadius: 2.5 }} />
      {marker !== undefined && <View style={{ position: "absolute", top: -2, left: `${Math.round(marker * 1000) / 10}%`, width: 1.2, height: 9, backgroundColor: ink }} />}
    </View>
  );
}

type Tile = [label: string, value: string, hint: string];

/** Headline figures on tinted tiles. `large` is the executive summary's size; `column` stacks them beside a chart. */
export function StatTiles({ tiles, large, column }: { tiles: Tile[]; large?: boolean; column?: boolean }) {
  const { theme, s } = useTheme();
  return (
    <View style={column ? { flex: 1, gap: 8 } : { flexDirection: "row", gap: 10, marginTop: large ? 8 : 2, marginBottom: large ? 6 : 10 }}>
      {tiles.map(([label, value, hint]) => (
        <View key={label} style={{ ...(column ? {} : { flex: 1 }), backgroundColor: theme.tint, borderRadius: 4, padding: large ? 10 : 8 }}>
          <Text style={{ ...s.small, textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
          <Text style={{ fontSize: large ? 22 : 17, fontWeight: 700, color: theme.heading, marginTop: large ? 2 : 1 }}>{value}</Text>
          <Text style={s.small}>{hint}</Text>
        </View>
      ))}
    </View>
  );
}

/** One reference per source: publisher, title, retrieved date and a link. */
export function SourceList({ sources }: { sources: Source[] }) {
  const { theme } = useTheme();
  return sources.map((src) => (
    <View key={src.id} wrap={false} style={{ marginBottom: 5 }}>
      <Text style={{ fontSize: 8.5 }}>
        <Text style={{ fontWeight: 600 }}>{src.publisher}.</Text> {sentence(src.title)} Retrieved {src.retrieved}.
      </Text>
      <Link src={src.url} style={{ fontSize: 7.5, color: theme.heading }}>{src.url.length > 110 ? `${src.url.slice(0, 108)}…` : src.url}</Link>
    </View>
  ));
}

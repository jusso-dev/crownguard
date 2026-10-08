import { Text, View, type Styles } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { Band } from "../engine/risk";

export const ink = "#1c2333";
export const muted = "#5b6478";
export const line = "#e2e5eb";
export const good = "#1d6b3f";

export const bandColors: Record<Band, { bg: string; fg: string }> = {
  Low: { bg: "#d9efe1", fg: "#1d5c36" },
  Medium: { bg: "#fbefc8", fg: "#7a5200" },
  High: { bg: "#fbd9c4", fg: "#8a3200" },
  Extreme: { bg: "#f6c9c9", fg: "#8c1414" },
};

export const severityColors = {
  critical: "#8c1414",
  high: "#8a3200",
  medium: "#7a5200",
  low: "#4a5568",
};

export function Badge({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <Text style={{ backgroundColor: bg, color: fg, fontSize: 7.5, fontWeight: 600, paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 2 }}>
      {children}
    </Text>
  );
}

export interface Column<T> {
  header: string;
  width: number | string;
  render: (row: T) => ReactNode;
}

export function Table<T>({ columns, rows, headerBg, zebra }: { columns: Column<T>[]; rows: T[]; headerBg: string; zebra: string }) {
  const cell: Styles[string] = { paddingVertical: 4, paddingHorizontal: 5 };
  return (
    <View style={{ borderWidth: 0.5, borderColor: line, borderRadius: 3 }}>
      <View style={{ flexDirection: "row", backgroundColor: headerBg }}>
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

export const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);

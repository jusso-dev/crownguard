import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import { createContext, useContext, type ReactNode } from "react";
import type { DocumentHeader } from "./model";
import { ink, line, muted, ThemeProvider, useTheme } from "./primitives";
import { stampText } from "./text";

const Header = createContext<{ header: DocumentHeader; title: string } | null>(null);

function useHeader() {
  const h = useContext(Header);
  if (!h) throw new Error("useHeader needs a ReportShell");
  return h;
}

/** A whole PDF: its metadata, the branded cover, and the header and footer every later page repeats. */
export function ReportShell({ header, title, coverLine, children }: { header: DocumentHeader; title: string; coverLine: string; children: ReactNode }) {
  return (
    <Document
      title={`${header.org} – ${title}`}
      author={header.branding.preparedBy || header.org}
      creator="crownguard"
      producer="crownguard"
      subject={title}
      creationDate={header.generatedAt}
      language="en-AU"
      pageMode="useOutlines"
    >
      <ThemeProvider theme={header.theme}>
        <Header.Provider value={{ header, title }}>
          <Cover coverLine={coverLine} />
          {children}
        </Header.Provider>
      </ThemeProvider>
    </Document>
  );
}

function Cover({ coverLine }: { coverLine: string }) {
  const { header: h, title } = useHeader();
  const { branding: b, theme } = h;
  return (
    <Page size="A4" style={{ fontFamily: "Inter", backgroundColor: theme.primary, color: theme.onPrimary, padding: 56 }} bookmark={{ title: "Cover", fit: true }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, backgroundColor: theme.accent }} />
      <Text style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2, textAlign: "center", marginTop: 4 }}>{b.marking}</Text>
      {b.logoDataUrl && (
        <View
          style={
            b.logoBackdrop === "white"
              ? { marginTop: 70, alignSelf: "flex-start", backgroundColor: "#ffffff", padding: 12, borderRadius: 4 }
              : { marginTop: 70, alignSelf: "flex-start" }
          }
        >
          <Image src={b.logoDataUrl} style={{ maxHeight: 72, maxWidth: 240, objectFit: "contain" }} />
        </View>
      )}
      <View style={{ marginTop: b.logoDataUrl ? 120 : 220 }}>
        <Text style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.85 }}>{title}</Text>
        <Text style={{ fontSize: 32, fontWeight: 700, marginTop: 8, lineHeight: 1.15 }}>{h.org}</Text>
        {h.abn && <Text style={{ fontSize: 11, marginTop: 6, opacity: 0.9 }}>ABN {h.abn}</Text>}
        <View style={{ height: 3, width: 56, backgroundColor: theme.accent, marginTop: 18, marginBottom: 18 }} />
        <Text style={{ fontSize: 12 }}>{coverLine}</Text>
      </View>
      <View style={{ position: "absolute", bottom: 72, left: 56, right: 56, fontSize: 9.5, lineHeight: 1.6 }}>
        {b.preparedFor && <Text>Prepared for: {b.preparedFor}</Text>}
        {b.preparedBy && <Text>Prepared by: {b.preparedBy}</Text>}
        <Text>Generated: {stampText(h.generatedAt)}</Text>
        <Text>Answers as at: {stampText(h.answersAsAt)}</Text>
      </View>
      <Text style={{ position: "absolute", bottom: 30, left: 0, right: 0, textAlign: "center", fontSize: 9, fontWeight: 700, letterSpacing: 1.2 }}>{b.marking}</Text>
    </Page>
  );
}

function PageChrome() {
  const { header: h, title } = useHeader();
  return (
    <>
      <View fixed style={{ position: "absolute", top: 20, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: muted }}>
        <Text>{h.org}</Text>
        <Text style={{ fontWeight: 700, color: ink }}>{h.branding.marking}</Text>
        <Text>{title}</Text>
      </View>
      <View fixed style={{ position: "absolute", bottom: 22, left: 46, right: 46, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: muted, borderTopWidth: 0.5, borderColor: line, paddingTop: 6 }}>
        <Text>Generated {stampText(h.generatedAt)}</Text>
        <Text style={{ fontWeight: 700, color: ink }}>{h.branding.marking}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </>
  );
}

/**
 * Each section is its own Page rather than a break inside one long Page: react-pdf lays out everything after each
 * page break again, so one Page for the whole report made rendering time grow with the square of its length.
 */
export function Section({ title, lead, id, children }: { title: string; lead?: string; id?: string; children: ReactNode }) {
  const { s } = useTheme();
  return (
    <Page size="A4" style={s.page} id={id} bookmark={{ title, fit: true }}>
      <PageChrome />
      <Text style={s.h1} minPresenceAhead={80}>{title}</Text>
      <View style={s.rule} />
      {lead && <Text style={s.lead}>{lead}</Text>}
      {children}
    </Page>
  );
}

/** A bulleted list in the theme's heading colour. */
export function Bullets({ items }: { items: string[] }) {
  const { theme } = useTheme();
  return items.map((item) => (
    <View key={item} style={{ flexDirection: "row", gap: 6, marginBottom: 3 }}>
      <Text style={{ width: 8, color: theme.heading }}>•</Text>
      <Text style={{ flex: 1, fontSize: 9, lineHeight: 1.4 }}>{item}</Text>
    </View>
  ));
}

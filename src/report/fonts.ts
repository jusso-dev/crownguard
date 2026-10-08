import { Font } from "@react-pdf/renderer";

export interface FontFiles {
  regular: string;
  italic: string;
  semibold: string;
  bold: string;
}

/** Registers the report font. Browser passes asset URLs; tests pass file paths. */
export function registerFonts(f: FontFiles) {
  Font.register({
    family: "Inter",
    fonts: [
      { src: f.regular, fontWeight: 400 },
      { src: f.italic, fontWeight: 400, fontStyle: "italic" },
      { src: f.semibold, fontWeight: 600 },
      { src: f.bold, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
}

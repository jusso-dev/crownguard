/** Node only: render a PDF to a file with the fonts shipped beside this module. */
import { renderToFile } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { DocumentProps } from "@react-pdf/renderer";
import { registerFontsFromDisk } from "./fonts";

export async function renderPdfToFile(document: ReactElement<DocumentProps>, outPath: string): Promise<void> {
  registerFontsFromDisk();
  await renderToFile(document, outPath);
}

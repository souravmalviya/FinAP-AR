// Digital PDFs carry their text inside the file. We pull it out with
// pdfjs-dist — Mozilla's PDF engine (the same one Firefox uses to render
// PDFs). Actively maintained, handles real-world files.
//
// (Scanned/photographed invoices have no embedded text and would need OCR —
// e.g. AWS Textract. That alternative path would slot in right here.)
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function pdfToText(bytes: Buffer): Promise<string> {
  // verbosity: 0 silences a harmless "standardFontDataUrl" warning in Node.
  const loadingTask = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  const pdf = await loadingTask.promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Each "item" is a text fragment; one per doc.text() call in simple PDFs.
    for (const item of content.items) {
      if ("str" in item && item.str.trim()) text += item.str + "\n";
    }
  }
  await loadingTask.destroy();
  return text;
}

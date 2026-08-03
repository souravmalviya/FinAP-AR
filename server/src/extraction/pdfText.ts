// Digital PDFs carry their text inside the file. We pull it out with
// pdfjs-dist - Mozilla's PDF engine (the same one Firefox uses to render
// PDFs). Actively maintained, handles real-world files.
//
// (Scanned/photographed invoices have no embedded text and would need OCR -
// e.g. AWS Textract. That alternative path would slot in right here.)
//
// --- Why the stubs and the lazy import below ---------------------------------
// pdfjs bundles a canvas RENDERING layer that constructs a DOMMatrix the
// moment the module is evaluated. Browsers have that global; in Node pdfjs
// borrows it from the optional native package @napi-rs/canvas, which is not
// always loadable (Windows Smart App Control blocks its unsigned Skia binary;
// slim Linux images often skip optional dependencies). When it is missing,
// merely importing pdfjs crashes the whole server at boot.
//
// We only ever READ TEXT - every DOMMatrix use in pdfjs lives in the canvas
// path we never execute - so the rendering layer only has to LOAD, not work.
// Minimal stubs achieve that with no 27 MB native dependency, and make PDF
// parsing behave identically on every machine we deploy to.
//
// The import is dynamic (not top-level) because the stubs must be installed
// BEFORE pdfjs is evaluated, and import statements are hoisted above ordinary
// code. Bonus: pdfjs now loads on first use instead of at boot.

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjs: PdfjsModule | null = null;

function installRenderingStubs(): void {
  const g = globalThis as unknown as Record<string, unknown>;

  if (typeof g.DOMMatrix === "undefined") {
    // Identity matrix with the standard properties. Deliberately NO
    // multiply/translate/scale methods: if rendering is ever added to this
    // codebase it should fail loudly here, not silently compute garbage.
    g.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      constructor(init?: number[]) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }
    };
  }

  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {};
  }
}

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjs) {
    installRenderingStubs(); // must run before the module is evaluated
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}

// Real-world PDFs (bank receipts, credit notes, anything not produced by our
// own pdfkit samples) can carry NUL bytes and other C0 control characters in
// their text layer. PostgreSQL's text type rejects 0x00 outright - error 22021,
// "invalid byte sequence for encoding UTF8" - so storing the extraction would
// fail and the document would end up FAILED through no fault of its own.
// Tab (09), newline (0A) and carriage return (0D) are kept; nothing else in
// that range carries meaning on an invoice.
const CONTROL_CHARS = new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]", "g");

export async function pdfToText(bytes: Buffer): Promise<string> {
  const { getDocument } = await loadPdfjs();

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
  return text.replace(CONTROL_CHARS, "");
}

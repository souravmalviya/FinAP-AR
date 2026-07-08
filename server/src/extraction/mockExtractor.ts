import { ExtractedInvoice, Extractor } from "./extractor.js";

// ----------------------------------------------------------------------------
//  MOCK engine: parses invoices with labelled lines using regex.
//  Works offline, costs nothing — perfect for local dev and demos.
//
//  It expects lines like:
//     Vendor: Acer India Pvt Ltd
//     Invoice No: ACR-556
//     PO Ref: PO-2026-007
//     Amount Due: INR 250000
//     Due Date: 2026-08-30
//
//  This is exactly why real products need an LLM: the regex breaks the moment
//  a vendor words things differently. The mock shows you that limitation
//  first-hand; the Claude engine handles any wording.
// ----------------------------------------------------------------------------

function find(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export const mockExtractor: Extractor = {
  name: "MOCK",

  async extract(rawText: string): Promise<ExtractedInvoice> {
    const vendorName = find(rawText, [/vendor\s*:\s*(.+)/i, /from\s*:\s*(.+)/i]);
    const invoiceNo = find(rawText, [/invoice\s*(?:no|number|#)\s*[:.]?\s*([A-Za-z0-9-]+)/i]);
    const poNumber = find(rawText, [/p\.?o\.?\s*(?:ref|number|no|#)?\s*[:.]?\s*([A-Za-z0-9-]+)/i]);

    const amountStr = find(rawText, [
      /amount\s*(?:due|payable)?\s*[:.]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /total\s*[:.]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]);
    const amount = amountStr ? Number(amountStr.replace(/,/g, "")) : null;

    const dueDate = find(rawText, [/due\s*date\s*[:.]?\s*(\d{4}-\d{2}-\d{2})/i]);

    return { vendorName, invoiceNo, poNumber, amount, dueDate };
  },
};

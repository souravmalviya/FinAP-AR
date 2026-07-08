// ----------------------------------------------------------------------------
//  The extraction contract. Both engines (mock + Claude) return this exact
//  shape, so the pipeline doesn't know or care which one ran.
//
//  Fields are nullable on purpose: extraction can PARTIALLY succeed, and the
//  verify rules downstream decide what's missing and what to do about it.
// ----------------------------------------------------------------------------

export interface ExtractedInvoice {
  vendorName: string | null;
  invoiceNo: string | null;
  poNumber: string | null; // the "PO Ref" printed on the invoice
  amount: number | null;
  dueDate: string | null; // ISO yyyy-mm-dd
}

export interface Extractor {
  name: "MOCK" | "CLAUDE" | "OPENROUTER";
  extract(rawText: string): Promise<ExtractedInvoice>;
}

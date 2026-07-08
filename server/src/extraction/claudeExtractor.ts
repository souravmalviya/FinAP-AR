import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { ExtractedInvoice, Extractor } from "./extractor.js";

// ----------------------------------------------------------------------------
//  CLAUDE engine: the real AI extraction (Layer 3, the ONLY AI in the system).
//
//  We ask for strict JSON and we treat the answer as UNTRUSTED: it is parsed,
//  type-checked, and later verified by the rules layer against the ERP's PO.
//  (Remember the principle: AI reads, rules decide.)
// ----------------------------------------------------------------------------

const SYSTEM = `You extract fields from invoice text. Reply with ONLY a JSON object, no prose:
{
  "vendorName": string | null,   // the company that SENT the invoice
  "invoiceNo": string | null,
  "poNumber": string | null,     // purchase-order reference, if printed
  "amount": number | null,       // total payable, digits only
  "dueDate": string | null       // ISO format yyyy-mm-dd
}
Use null when a field is absent. Never guess numbers.`;

export const claudeExtractor: Extractor = {
  name: "CLAUDE",

  async extract(rawText: string): Promise<ExtractedInvoice> {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: rawText.slice(0, 8000) }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    // Tolerate accidental code fences around the JSON.
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());

    return {
      vendorName: typeof json.vendorName === "string" ? json.vendorName : null,
      invoiceNo: typeof json.invoiceNo === "string" ? json.invoiceNo : null,
      poNumber: typeof json.poNumber === "string" ? json.poNumber : null,
      amount: typeof json.amount === "number" ? json.amount : null,
      dueDate: typeof json.dueDate === "string" ? json.dueDate : null,
    };
  },
};

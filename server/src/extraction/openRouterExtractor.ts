import { env } from "../config/env.js";
import { ExtractedInvoice, Extractor } from "./extractor.js";

// ----------------------------------------------------------------------------
//  OPENROUTER engine — real AI extraction via OpenRouter (openrouter.ai).
//
//  Why OpenRouter? One API key fronts many models (Claude, GPT, Gemini...).
//  The model is picked by env var OPENROUTER_MODEL, so switching models is a
//  config change, not a code change.
//
//  OpenRouter speaks the OpenAI chat-completions format, so we call it with
//  plain fetch — no SDK needed. As always: the answer is treated as UNTRUSTED
//  and re-verified by the rules layer before any money moves.
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

export const openRouterExtractor: Extractor = {
  name: "OPENROUTER",

  async extract(rawText: string): Promise<ExtractedInvoice> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        max_tokens: 500,
        temperature: 0, // extraction wants determinism, not creativity
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: rawText.slice(0, 8000) },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Throwing lets the queue retry (and eventually mark FAILED) — we never
      // silently continue with empty data.
      throw new Error(`OpenRouter error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as any;
    const text: string = data.choices?.[0]?.message?.content ?? "{}";
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

import { ExtractedInvoice } from "../extraction/extractor.js";
import * as erp from "../erp/erpClient.js";

// ----------------------------------------------------------------------------
//  VERIFY (Layer 4) - pure deterministic rules. No AI anywhere in this file.
//
//  Input:  what the AI *claims* the invoice says.
//  Output: a verdict - either "clean, here's the ERP vendor + PO to use"
//          or "needs a human, here's exactly why".
//
//  Rule order matters: cheapest checks first, and we verify facts BEFORE
//  anyone is asked to approve anything.
// ----------------------------------------------------------------------------

export type VerifyResult =
  | {
      ok: true;
      vendor: erp.ErpVendor;
      po: erp.ErpPurchaseOrder; // the PO the invoice bills against
    }
  | {
      ok: false;
      reason: string; // human-readable - shown in the review queue
      detail?: object;
    };

// --- Vendor matching ---------------------------------------------------------
// Invoices rarely print a company's registered name exactly ("Acer" on the
// letterhead vs "Acer India Pvt Ltd" in the ERP), so containment matching is
// necessary. But containment alone is dangerous when several suppliers have
// overlapping names: picking whichever row the ERP happened to return first
// can attach the invoice to the WRONG vendor, which then fails rule 4 with a
// confusing reason - or worse, quietly matches a PO that isn't theirs.
//
// So: exact wins first, and a genuinely ambiguous name goes to a human rather
// than being guessed. Money never moves on a coin flip.
export type VendorMatch =
  | { kind: "found"; vendor: erp.ErpVendor }
  | { kind: "none" }
  | { kind: "ambiguous"; candidates: string[] };

export function matchVendor(vendors: erp.ErpVendor[], extractedName: string): VendorMatch {
  const wanted = extractedName.toLowerCase().trim();

  // Pass 1 - exact name, case-insensitive. The unambiguous case.
  const exact = vendors.filter((v) => v.name.toLowerCase().trim() === wanted);
  if (exact.length > 0) return { kind: "found", vendor: exact[0] };

  // Pass 2 - containment either direction.
  const partial = vendors.filter((v) => {
    const name = v.name.toLowerCase().trim();
    return name.includes(wanted) || wanted.includes(name);
  });
  if (partial.length === 1) return { kind: "found", vendor: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial.map((v) => v.name) };

  return { kind: "none" };
}

export async function verify(
  organizationId: string,
  extracted: ExtractedInvoice
): Promise<VerifyResult> {
  // Rule 1 - the AI must have produced the minimum viable fields.
  if (!extracted.vendorName || !extracted.invoiceNo || !extracted.amount) {
    return {
      ok: false,
      reason: "Extraction incomplete - missing vendor, invoice number, or amount",
      detail: { extracted },
    };
  }

  // Rule 2 - the vendor must already exist in the ERP.
  // (An invoice from an unknown company is exactly how fraud starts.)
  const vendors = await erp.listVendors(organizationId);
  const match = matchVendor(vendors, extracted.vendorName);
  if (match.kind === "none") {
    return {
      ok: false,
      reason: `Unknown vendor "${extracted.vendorName}" - not registered in the ERP`,
    };
  }
  if (match.kind === "ambiguous") {
    return {
      ok: false,
      reason: `Vendor "${extracted.vendorName}" matches ${match.candidates.length} suppliers in the ERP - a human must decide which one`,
      detail: { candidates: match.candidates },
    };
  }
  const vendor = match.vendor;

  // Rule 3 - the invoice must reference a PO we actually raised.
  if (!extracted.poNumber) {
    return {
      ok: false,
      reason: "Invoice has no PO reference - cannot verify what it bills against",
    };
  }
  const openPOs = await erp.listOpenPOs(organizationId);
  const po = openPOs.find(
    (p) => p.poNumber.toLowerCase() === extracted.poNumber!.toLowerCase()
  );
  if (!po) {
    return {
      ok: false,
      reason: `No OPEN purchase order "${extracted.poNumber}" found in the ERP`,
    };
  }

  // Rule 4 - the PO must belong to the same vendor that sent the invoice.
  if (po.vendorId !== vendor.id) {
    return {
      ok: false,
      reason: `PO ${po.poNumber} belongs to a different vendor than "${vendor.name}"`,
    };
  }

  // Rule 5 - THE MATCH: invoice amount must equal the PO amount.
  if (Number(po.amount) !== extracted.amount) {
    return {
      ok: false,
      reason: `Amount mismatch - invoice says ₹${extracted.amount}, PO says ₹${Number(po.amount)}`,
      detail: { invoiceAmount: extracted.amount, poAmount: Number(po.amount) },
    };
  }

  return { ok: true, vendor, po };
}

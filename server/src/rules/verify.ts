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

// Vendor names never match exactly ("Acer India Pvt Ltd" vs "Acer").
// Normalise both sides and accept containment either way.
function vendorMatches(erpName: string, extractedName: string): boolean {
  const a = erpName.toLowerCase().trim();
  const b = extractedName.toLowerCase().trim();
  return a.includes(b) || b.includes(a);
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
  const vendor = vendors.find((v) => vendorMatches(v.name, extracted.vendorName!));
  if (!vendor) {
    return {
      ok: false,
      reason: `Unknown vendor "${extracted.vendorName}" - not registered in the ERP`,
    };
  }

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

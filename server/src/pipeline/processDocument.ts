import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { audit } from "../audit/audit.js";
import { getObject } from "../lib/storage.js";
import { pdfToText } from "../extraction/pdfText.js";
import { getExtractor } from "../extraction/index.js";
import { verify } from "../rules/verify.js";
import { route } from "../rules/route.js";
import * as erp from "../erp/erpClient.js";

// ----------------------------------------------------------------------------
//  THE PIPELINE - one document's journey, exactly the explainer diagram:
//
//    EXTRACT (AI)  ->  VERIFY (rules)  ->  ERP WRITE  ->  ROUTE (rules)
//
//  This function is run BY THE QUEUE WORKER, so if it throws, pg-boss
//  retries it automatically. Every step writes an audit event.
// ----------------------------------------------------------------------------

export async function processDocument(documentId: string): Promise<void> {
  const doc = await prisma.ingestedDocument.findUnique({ where: { id: documentId } });
  if (!doc) return; // deleted meanwhile - nothing to do

  // Idempotency guard: if a retry lands after we already finished, skip.
  // Only documents still in QUEUED state are processed.
  if (doc.status !== "QUEUED") {
    console.log(`[pipeline] doc ${documentId.slice(0, 8)} already ${doc.status}, skipping`);
    return;
  }

  const orgId = doc.organizationId;

  try {
    // ---- STEP: EXTRACT (the only AI step) --------------------------------
    await setStatus(documentId, "EXTRACTING");
    const bytes = await getObject(doc.storageKey);
    const rawText = await pdfToText(bytes);

    const extractor = getExtractor();
    const extracted = await extractor.extract(rawText);

    await prisma.extraction.create({
      data: {
        documentId,
        rawText,
        vendorName: extracted.vendorName,
        invoiceNo: extracted.invoiceNo,
        poNumber: extracted.poNumber,
        amount: extracted.amount != null ? new Prisma.Decimal(extracted.amount) : null,
        dueDate: extracted.dueDate ? new Date(extracted.dueDate) : null,
        engine: extractor.name,
      },
    });
    await audit(orgId, documentId, "EXTRACT", "AI",
      `Engine ${extractor.name} read: vendor="${extracted.vendorName}" invoice=${extracted.invoiceNo} po=${extracted.poNumber} amount=${extracted.amount}`,
      { extracted });

    // ---- STEP: VERIFY (rules - the safety net) ----------------------------
    const verdict = await verify(orgId, extracted);
    if (!verdict.ok) {
      await prisma.ingestedDocument.update({
        where: { id: documentId },
        data: { status: "NEEDS_REVIEW", failReason: verdict.reason },
      });
      await audit(orgId, documentId, "VERIFY", "RULE", `FLAGGED: ${verdict.reason}`, verdict.detail);
      return; // stops here - a human must look at it. No money moves.
    }
    await audit(orgId, documentId, "VERIFY", "RULE",
      `Clean ✓ vendor=${verdict.vendor.name}, PO=${verdict.po.poNumber}, amounts equal`);

    // ---- STEP: WRITE TO ERP (create the AP invoice, linked to the PO) -----
    let erpInvoice: erp.ErpInvoice;
    try {
      erpInvoice = await erp.createInvoice(orgId, {
        invoiceNo: extracted.invoiceNo!,
        amount: extracted.amount!,
        dueDate: extracted.dueDate ?? thirtyDaysFromNow(),
        vendorId: verdict.vendor.id,
        purchaseOrderId: verdict.po.id,
      });
    } catch (e) {
      if (e instanceof erp.ErpError && e.status === 409) {
        // Same invoice number already in the ERP -> a re-sent bill. Not an error;
        // it's the second line of duplicate defence (first was the file hash).
        await prisma.ingestedDocument.update({
          where: { id: documentId },
          data: { status: "DUPLICATE", failReason: `ERP: ${e.message}` },
        });
        await audit(orgId, documentId, "ERP_SYNC", "RULE", `Duplicate invoice number - ${e.message}`);
        return;
      }
      throw e; // real failure -> let the queue retry
    }

    await prisma.ingestedDocument.update({
      where: { id: documentId },
      data: { status: "MATCHED", erpInvoiceId: erpInvoice.id, erpPoId: verdict.po.id },
    });
    await audit(orgId, documentId, "ERP_SYNC", "SYSTEM",
      `Invoice ${erpInvoice.invoiceNo} created in ERP, linked to ${verdict.po.poNumber} (now MATCHED)`);

    // ---- STEP: ROUTE (threshold rules decide who approves) ----------------
    const decision = route(extracted.amount!);

    if (decision.kind === "AUTO_APPROVE") {
      await erp.setInvoiceStatus(orgId, erpInvoice.id, "APPROVED");
      await prisma.ingestedDocument.update({
        where: { id: documentId }, data: { status: "APPROVED" },
      });
      await audit(orgId, documentId, "ROUTE", "RULE",
        `₹${extracted.amount} < ₹50,000 → auto-approved, no human needed`);
    } else {
      await erp.setInvoiceStatus(orgId, erpInvoice.id, "PENDING_APPROVAL");
      await prisma.approvalTask.create({
        data: { organizationId: orgId, documentId, requiredRole: decision.role },
      });
      await prisma.ingestedDocument.update({
        where: { id: documentId }, data: { status: "PENDING_APPROVAL" },
      });
      await audit(orgId, documentId, "ROUTE", "RULE",
        `₹${extracted.amount} requires ${decision.role} approval - task created`);
    }
  } catch (err) {
    // Let pg-boss retry; if retries are exhausted it stays FAILED.
    const message = err instanceof Error ? err.message : String(err);
    await prisma.ingestedDocument.update({
      where: { id: documentId },
      data: { status: "FAILED", failReason: message },
    }).catch(() => {});
    await audit(orgId, documentId, "ERROR", "SYSTEM", `Pipeline failed: ${message}`).catch(() => {});
    // Reset to QUEUED so a retry attempt is allowed to run again.
    await prisma.ingestedDocument.update({
      where: { id: documentId }, data: { status: "QUEUED" },
    }).catch(() => {});
    throw err;
  }
}

async function setStatus(documentId: string, status: "EXTRACTING") {
  await prisma.ingestedDocument.update({ where: { id: documentId }, data: { status } });
}

function thirtyDaysFromNow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}
